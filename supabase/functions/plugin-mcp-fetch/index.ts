import { createClient } from "npm:@supabase/supabase-js@2";
import { callAllemannsdata, mapWithConcurrency } from "../_shared/allemannsdata.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Allemannsdata "firmafakta" operations — verified live, read-only, no auth.
const TEMPLATES: Record<string, { source: string; operation: string; dataset_type: string }> = {
  skattefunn: { source: "firmafakta", operation: "skattefunnprosjekter_for_selskap", dataset_type: "skattefunn" },
  grants: { source: "firmafakta", operation: "tildelinger_for_selskap", dataset_type: "grants" },
  eu_grants: { source: "firmafakta", operation: "eu_tildelinger_for_selskap", dataset_type: "eu_grants" },
  research_council: { source: "firmafakta", operation: "forskningsradet_tildelinger_for_selskap", dataset_type: "research_council" },
  jobs: { source: "firmafakta", operation: "stillinger_for_selskap", dataset_type: "jobs" },
  ip_rights: { source: "firmafakta", operation: "get_company_ip_rights", dataset_type: "ip_rights" },
  financials: { source: "firmafakta", operation: "get_company_last_financial_statement", dataset_type: "financials" },
};

const BATCH = 40;
const CONCURRENCY = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { template_id, plugin_id, job_id, after_orgnr, running_total, failures, processed, total_companies } =
      await req.json();
    const template = TEMPLATES[template_id];
    if (!template || !plugin_id || !job_id) {
      return new Response(JSON.stringify({ error: "Invalid params", valid_templates: Object.keys(TEMPLATES) }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve the company universe once, then carry it through the chain for progress reporting.
    let totalCompanies = Number(total_companies ?? 0);
    if (!totalCompanies) {
      const { count } = await supabase.from("companies").select("id", { count: "exact", head: true });
      totalCompanies = count ?? 0;
    }
    const doneSoFar = Number(processed ?? 0);

    let query = supabase.from("companies").select("orgnr").order("orgnr").limit(BATCH);
    if (after_orgnr) query = query.gt("orgnr", after_orgnr);
    const { data: companies, error: queryError } = await query;

    if (queryError) throw queryError;

    if (!companies || companies.length === 0) {
      const { count } = await supabase
        .from("plugin_data")
        .select("id", { count: "exact", head: true })
        .eq("plugin_id", plugin_id);
      await supabase.from("plugins").update({ row_count: count ?? 0 }).eq("id", plugin_id);
      await supabase.rpc("cross_reference_plugin", { p_plugin_id: plugin_id });
      await supabase.from("jobs").update({ status: "completed", progress: 100 }).eq("id", job_id);
      await supabase.from("plugin_logs").insert({
        plugin_id,
        action: "mcp_fetch_completed",
        details: { template_id, source: "allemannsdata", total_rows: count, failures: failures ?? 0 },
      });
      return new Response(JSON.stringify({ done: true, total: running_total ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lastOrgnr = companies[companies.length - 1].orgnr;

    const results = await mapWithConcurrency(companies, CONCURRENCY, async (c) => {
      const res = await callAllemannsdata<Record<string, unknown>>(
        template.source,
        template.operation,
        { organization_id: c.orgnr, limit: 50 },
      );
      return { orgnr: c.orgnr, res };
    });

    const rows: { plugin_id: string; orgnr: string; row_data: Record<string, unknown> }[] = [];
    let failed = 0;
    for (const { orgnr, res } of results) {
      if (!res.ok) {
        failed++;
        continue;
      }
      for (const item of res.data) {
        rows.push({
          plugin_id,
          orgnr,
          row_data: { ...item, _source: "allemannsdata", _retrieved_at: res.retrievedAt ?? new Date().toISOString() },
        });
      }
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("plugin_data").insert(rows);
      if (insertError) throw insertError;
    }

    const newTotal = (running_total ?? 0) + rows.length;
    const newFailures = (failures ?? 0) + failed;

    // Circuit breaker: if the upstream source is failing wholesale, stop instead of burning quota.
    if (failed === companies.length && companies.length > 0) {
      await supabase.from("jobs").update({
        status: "failed",
        metadata: { last_orgnr: lastOrgnr, total_fetched: newTotal, error: "Allemannsdata unavailable for entire batch" },
      }).eq("id", job_id);
      await supabase.from("plugin_logs").insert({
        plugin_id,
        action: "mcp_fetch_aborted",
        details: { template_id, reason: "upstream_unavailable", last_orgnr: lastOrgnr },
      });
      return new Response(JSON.stringify({ aborted: true, reason: "upstream_unavailable" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("jobs").update({
      status: "running",
      metadata: { last_orgnr: lastOrgnr, total_fetched: newTotal, failures: newFailures, source: "allemannsdata" },
    }).eq("id", job_id);

    supabase.functions.invoke("plugin-mcp-fetch", {
      body: { template_id, plugin_id, job_id, after_orgnr: lastOrgnr, running_total: newTotal, failures: newFailures },
    }).catch(() => {});

    return new Response(JSON.stringify({ inserted: rows.length, failed, last_orgnr: lastOrgnr, running_total: newTotal }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("MCP fetch error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
