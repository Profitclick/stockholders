// Ingests awarded public contracts from Doffin (via Allemannsdata) and links
// winners to registered companies so procurement becomes a scoring signal.
// Runs in bounded page windows and self-chains so long crawls never time out.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAllemannsdata, mapWithConcurrency } from "../_shared/allemannsdata.ts";

const AWARD_TYPE = "ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT";
const HITS_PER_PAGE = 50;
const PAGES_PER_RUN = 30;
const NOTICE_CONCURRENCY = 4;
const JOB_TITLE = "Doffin: offentlige kontraktstildelinger";

interface Hit {
  id: string;
  heading?: string;
  buyer?: Array<{ name?: string; organization_id?: string }>;
  estimatedValue?: { amount?: number; currencyCode?: string } | null;
  publicationDate?: string;
}

function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+(AS|ASA|ANS|DA|SA|BA|NUF|KS|AB|A\/S)\.?$/g, "")
    .replace(/[^A-ZÆØÅ0-9 ]/g, "")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dateFrom = typeof body.date_from === "string" ? body.date_from : "2024-01-01";
  const maxPages = Math.min(Number(body.max_pages) || 400, 1000);
  const startPage = Math.max(1, Number(body.page_from) || 1);
  const resumeJobId = typeof body.job_id === "string" ? body.job_id : null;
  const carried = {
    processed: Number(body.processed) || 0,
    awards: Number(body.awards) || 0,
  };

  let jobId = resumeJobId;

  if (!jobId) {
    const { data: running } = await supabase
      .from("jobs")
      .select("id")
      .eq("type", "doffin_ingest")
      .in("status", ["queued", "running"])
      .limit(1);

    if (running && running.length > 0) {
      return new Response(
        JSON.stringify({ error: "En Doffin-innhenting kjører allerede", job_id: running[0].id }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "doffin_ingest",
        status: "running",
        metadata: { title: JOB_TITLE, date_from: dateFrom, processed: 0, total: 0, awards: 0 },
      })
      .select()
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: jobError?.message ?? "Kunne ikke opprette jobb" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    jobId = job.id;
  }

  const run = async () => {
    let processed = carried.processed;
    let awards = carried.awards;
    let failures = 0;
    let total = 0;
    let page = startPage;
    let exhausted = false;

    const setJob = (patch: Record<string, unknown>) =>
      supabase
        .from("jobs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", jobId!);

    try {
      for (let i = 0; i < PAGES_PER_RUN && page <= maxPages; i++, page++) {
        const res = await callAllemannsdata<{ total_count?: number; hits?: Hit[] }>(
          "doffin",
          "search_doffin",
          { types: AWARD_TYPE, date_from: dateFrom, hits_per_page: HITS_PER_PAGE, page, limit: 200 },
        );

        if (!res.ok) {
          failures++;
          if (failures > 5) break;
          continue;
        }

        const payload = res.data[0] ?? {};
        total = payload.total_count ?? total;
        const hits = payload.hits ?? [];
        if (hits.length === 0) {
          exhausted = true;
          break;
        }

        const rows = await mapWithConcurrency(hits, NOTICE_CONCURRENCY, async (hit) => {
          const detail = await callAllemannsdata<{
            awardedNames?: string[];
            directCpvCodes?: string[];
            doffin_url?: string;
          }>("doffin", "get_notice", { notice_id: hit.id });
          const d = detail.data[0] ?? {};
          const names = Array.from(
            new Set((d.awardedNames ?? []).filter((n) => typeof n === "string" && n.trim().length > 1)),
          );
          return names
            .map((name) => ({
              notice_id: hit.id,
              heading: hit.heading ?? null,
              buyer_name: hit.buyer?.[0]?.name ?? null,
              buyer_orgnr: (hit.buyer?.[0]?.organization_id ?? "").replace(/\s/g, "") || null,
              awarded_name: name,
              awarded_name_norm: normalizeName(name) || null,
              estimated_value: hit.estimatedValue?.amount ?? null,
              currency: hit.estimatedValue?.currencyCode ?? null,
              publication_date: hit.publicationDate ?? null,
              cpv_codes: d.directCpvCodes ?? [],
              doffin_url: d.doffin_url ?? `https://doffin.no/notices/${hit.id}`,
            }))
            .filter((r) => r.awarded_name_norm);
        });

        const flat = rows.flat();
        // De-duplicate inside the batch so upsert never hits the same key twice.
        const seen = new Set<string>();
        const unique = flat.filter((r) => {
          const key = `${r.notice_id}|${r.awarded_name_norm}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (unique.length > 0) {
          const { error } = await supabase
            .from("contract_awards")
            .upsert(unique, { onConflict: "notice_id,awarded_name_norm", ignoreDuplicates: true });
          if (!error) awards += unique.length;
        }

        processed += hits.length;

        await setJob({
          progress: total > 0 ? Math.min(99, (processed / total) * 100) : 0,
          current_batch: page,
          total_batches: Math.min(maxPages, Math.ceil((total || 1) / 25)),
          errors_count: failures,
          metadata: { title: JOB_TITLE, date_from: dateFrom, processed, total, awards, page },
        });
      }

      const moreToDo = !exhausted && page <= maxPages;

      if (moreToDo) {
        // Chain the next window in a fresh invocation.
        await fetch(`${supabaseUrl}/functions/v1/doffin-ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            date_from: dateFrom,
            max_pages: maxPages,
            page_from: page,
            job_id: jobId,
            processed,
            awards,
          }),
        });
        return;
      }

      await supabase.rpc("refresh_company_signals");
      await setJob({
        status: "completed",
        progress: 100,
        errors_count: failures,
        metadata: { title: JOB_TITLE, date_from: dateFrom, processed, total, awards },
      });
    } catch (err) {
      await setJob({
        status: "failed",
        metadata: {
          title: JOB_TITLE,
          error: err instanceof Error ? err.message : String(err),
          processed,
          awards,
        },
      });
    }
  };

  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(run());
  else run();

  return new Response(JSON.stringify({ job_id: jobId, started: true, page_from: startPage }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
