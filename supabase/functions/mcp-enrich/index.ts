import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/mcp-enrich`;
const BRREG_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter";
const BRREG_REGNSKAP = "https://data.brreg.no/regnskapsregisteret/regnskap";

const BATCH_SIZE = 15;
const CONCURRENCY = 3;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

type Payload = {
  job_id?: string;
  after_orgnr?: string | null;
  enriched_count?: number;
  error_count?: number;
  batch_size?: number;
  retry_count?: number;
  run_scoring_after?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// --- Brreg company details ---
async function fetchBrregCompany(orgnr: string) {
  try {
    const res = await fetchWithTimeout(`${BRREG_BASE}/${orgnr}`);
    if (!res.ok) { await res.text(); return null; }
    return await res.json();
  } catch { return null; }
}

// --- Brreg roles ---
async function fetchBrregRoles(orgnr: string) {
  try {
    const res = await fetchWithTimeout(`${BRREG_BASE}/${orgnr}/roller`, 5000);
    if (!res.ok) { await res.text(); return null; }
    const data = await res.json();
    return (data.rollegrupper ?? []).map((g: any) => ({
      type: g.type?.beskrivelse,
      roles: (g.roller ?? []).map((r: any) => ({
        name: r.person?.navn?.fornavn
          ? `${r.person.navn.fornavn} ${r.person.navn.etternavn}`
          : r.enhet?.organisasjonsnummer,
        title: r.type?.beskrivelse,
      })),
    }));
  } catch { return null; }
}

// --- Brreg financial statements ---
async function fetchBrregFinancials(orgnr: string) {
  try {
    const res = await fetchWithTimeout(`${BRREG_REGNSKAP}/${orgnr}`, 6000);
    if (!res.ok) { await res.text(); return null; }
    const data = await res.json();
    const latest = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!latest) return null;

    const resultat = latest.resultatregnskapResultat ?? {};
    const drift = resultat.driftsresultat ?? {};
    const ek = latest.egenkapitalGjeld ?? {};

    return {
      regnskapsperiode: latest.regnskapsperiode,
      revenue: drift.driftsinntekter?.sumDriftsinntekter ?? null,
      operating_profit: drift.driftsresultat ?? null,
      net_profit: resultat.aarsresultat ?? null,
      total_assets: latest.eiendeler?.sumEiendeler ?? null,
      equity: ek.egenkapital?.sumEgenkapital ?? null,
      total_debt: ek.gjeldOversikt?.sumGjeld ?? null,
      short_term_debt: ek.gjeldOversikt?.kortsiktigGjeld?.sumKortsiktigGjeld ?? null,
      long_term_debt: ek.gjeldOversikt?.langsiktigGjeld?.sumLangsiktigGjeld ?? null,
    };
  } catch { return null; }
}

// --- Combined enrichment ---
async function enrichCompany(orgnr: string): Promise<Record<string, unknown> | null> {
  const [companyData, rolesData, financialsData] = await Promise.all([
    fetchBrregCompany(orgnr),
    fetchBrregRoles(orgnr),
    fetchBrregFinancials(orgnr),
  ]);

  if (!companyData) return null;

  const industry = companyData.naeringskode1?.beskrivelse ?? null;
  const naceCode = companyData.naeringskode1?.kode ?? null;
  const employees = companyData.antallAnsatte;
  const size = employees != null
    ? employees <= 10 ? "micro"
      : employees <= 50 ? "small"
      : employees <= 250 ? "medium"
      : "large"
    : null;

  const email = companyData.epostadresse ?? null;
  const phone = companyData.telefonnummer ?? null;
  const website = companyData.hjemmeside ?? null;
  const address = companyData.forretningsadresse
    ? [companyData.forretningsadresse.adresse?.[0], companyData.forretningsadresse.postnummer, companyData.forretningsadresse.poststed].filter(Boolean).join(", ")
    : null;

  return {
    name: companyData.navn ?? null,
    industry,
    size,
    enriched: true,
    email,
    phone,
    website,
    address,
    brreg_data: {
      organisasjonsform: companyData.organisasjonsform?.beskrivelse,
      naeringskode1: companyData.naeringskode1,
      nace_code: naceCode,
      antallAnsatte: employees,
      forretningsadresse: companyData.forretningsadresse,
      stiftelsesdato: companyData.stiftelsesdato,
      registrertIMvaregisteret: companyData.registrertIMvaregisteret,
      registreringsdatoEnhetsregisteret: companyData.registreringsdatoEnhetsregisteret,
      roles: rolesData,
      financials: financialsData,
    },
  };
}

async function invokeNext(payload: Payload) {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(payload),
  });
  await response.text();
}

async function processBatch(payload: Required<Payload>) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    let query = supabase
      .from("companies")
      .select("id, orgnr, name")
      .eq("enriched", false)
      .order("orgnr", { ascending: true })
      .limit(payload.batch_size);

    if (payload.after_orgnr) {
      query = query.gt("orgnr", payload.after_orgnr);
    }

    const { data: companies, error } = await query;
    if (error) throw new Error(`Query failed: ${error.message}`);

    if (!companies || companies.length === 0) {
      await supabase.from("jobs").update({
        status: "completed",
        progress: 100,
        metadata: {
          enriched: payload.enriched_count,
          errors: payload.error_count,
          completed_at: new Date().toISOString(),
        },
      }).eq("id", payload.job_id);

      await supabase.from("audit_log").insert({
        action: "mcp_enrichment_completed",
        entity_type: "job",
        entity_id: payload.job_id,
        details: { enriched: payload.enriched_count, errors: payload.error_count },
      });

      if (payload.run_scoring_after) {
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/ias-scoring`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              apikey: SERVICE_ROLE_KEY,
            },
            body: JSON.stringify({}),
          });
        } catch { /* best effort */ }
      }
      return;
    }

    let enriched = 0;
    let errors = 0;

    for (let i = 0; i < companies.length; i += CONCURRENCY) {
      const chunk = companies.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        chunk.map(async (company) => {
          const data = await enrichCompany(company.orgnr);
          if (!data) { errors++; return; }

          const { error: updateErr } = await supabase
            .from("companies")
            .update({
              ...data,
              name: (data.name as string) ?? company.name,
            })
            .eq("id", company.id);

          if (updateErr) errors++;
          else enriched++;
        })
      );

      if (i + CONCURRENCY < companies.length) await sleep(300);
    }

    const totalEnriched = payload.enriched_count + enriched;
    const totalErrors = payload.error_count + errors;
    const lastOrgnr = companies[companies.length - 1].orgnr;

    await supabase.from("jobs").update({
      status: "running",
      metadata: {
        enriched: totalEnriched,
        errors: totalErrors,
        last_orgnr: lastOrgnr,
        batch_size: payload.batch_size,
      },
    }).eq("id", payload.job_id);

    await invokeNext({
      job_id: payload.job_id,
      after_orgnr: lastOrgnr,
      enriched_count: totalEnriched,
      error_count: totalErrors,
      batch_size: payload.batch_size,
      retry_count: 0,
      run_scoring_after: payload.run_scoring_after,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isRetryable = message.includes("timeout") || message.includes("schema cache") || message.includes("520");

    if (isRetryable && payload.retry_count < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      await invokeNext({
        ...payload,
        retry_count: payload.retry_count + 1,
        batch_size: Math.max(5, Math.floor(payload.batch_size / 2)),
      });
      return;
    }

    await supabase.from("jobs").update({
      status: "failed",
      metadata: {
        enriched: payload.enriched_count,
        errors: payload.error_count,
        error: message,
        last_orgnr: payload.after_orgnr,
      },
    }).eq("id", payload.job_id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));

    // Continuation call
    if (body.job_id && body.after_orgnr !== undefined) {
      EdgeRuntime.waitUntil(
        processBatch({
          job_id: body.job_id,
          after_orgnr: body.after_orgnr ?? null,
          enriched_count: body.enriched_count ?? 0,
          error_count: body.error_count ?? 0,
          batch_size: body.batch_size ?? BATCH_SIZE,
          retry_count: body.retry_count ?? 0,
          run_scoring_after: body.run_scoring_after ?? true,
        })
      );

      return new Response(JSON.stringify({ ok: true, job_id: body.job_id }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initial call
    const { count } = await supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("enriched", false);

    if (!count || count === 0) {
      return new Response(JSON.stringify({ message: "No companies to enrich", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: activeJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("type", "mcp_enrichment")
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle();

    if (activeJob) {
      return new Response(JSON.stringify({ status: "already_running", job_id: activeJob.id }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job } = await supabase
      .from("jobs")
      .insert({
        type: "mcp_enrichment",
        status: "running",
        total_batches: Math.ceil(count / BATCH_SIZE),
        metadata: { total_to_enrich: count },
      })
      .select("id")
      .single();

    if (!job) {
      return new Response(JSON.stringify({ error: "Failed to create job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    EdgeRuntime.waitUntil(
      processBatch({
        job_id: job.id,
        after_orgnr: null,
        enriched_count: 0,
        error_count: 0,
        batch_size: BATCH_SIZE,
        retry_count: 0,
        run_scoring_after: body.run_scoring_after ?? true,
      })
    );

    return new Response(JSON.stringify({ status: "accepted", job_id: job.id, to_enrich: count }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("MCP enrichment error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
