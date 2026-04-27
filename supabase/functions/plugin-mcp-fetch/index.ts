import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMPLATES: Record<string, { endpoint: string; dataset_type: string }> = {
  skattefunn: { endpoint: "skattefunn", dataset_type: "skattefunn" },
  grants: { endpoint: "tildelinger", dataset_type: "grants" },
  eu_grants: { endpoint: "eu_tildelinger", dataset_type: "eu_grants" },
  research_council: { endpoint: "forskningsradet_tildelinger", dataset_type: "research_council" },
};

const BASE_URL = "https://offentligdata.com/api";
const BATCH = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { template_id, plugin_id, job_id, after_orgnr, running_total } = await req.json();
    const template = TEMPLATES[template_id];
    if (!template || !plugin_id || !job_id) {
      return new Response(JSON.stringify({ error: "Invalid params" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get batch of orgnrs
    let query = supabase.from("companies").select("orgnr").order("orgnr").limit(BATCH);
    if (after_orgnr) query = query.gt("orgnr", after_orgnr);
    const { data: companies } = await query;

    if (!companies || companies.length === 0) {
      // Done — finalize
      const { count } = await supabase.from("plugin_data").select("id", { count: "exact", head: true }).eq("plugin_id", plugin_id);
      await supabase.from("plugins").update({ row_count: count ?? 0 }).eq("id", plugin_id);
      await supabase.rpc("cross_reference_plugin", { p_plugin_id: plugin_id });
      await supabase.from("jobs").update({ status: "completed", progress: 100 }).eq("id", job_id);
      await supabase.from("plugin_logs").insert({
        plugin_id,
        action: "mcp_fetch_completed",
        details: { template_id, total_rows: count },
      });
      return new Response(JSON.stringify({ done: true, total: running_total ?? 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;
    const lastOrgnr = companies[companies.length - 1].orgnr;

    for (const c of companies) {
      try {
        const resp = await fetch(`${BASE_URL}/${template.endpoint}/${c.orgnr}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        const items = Array.isArray(data) ? data : data?.data ? (Array.isArray(data.data) ? data.data : [data.data]) : [data];
        if (items.length === 0) continue;

        const rows = items.map((item: Record<string, unknown>) => ({
          plugin_id,
          orgnr: c.orgnr,
          row_data: item,
        }));
        await supabase.from("plugin_data").insert(rows);
        inserted += rows.length;
      } catch {
        // Skip failed orgnrs
      }
    }

    const newTotal = (running_total ?? 0) + inserted;
    await supabase.from("jobs").update({
      status: "running",
      metadata: { last_orgnr: lastOrgnr, total_fetched: newTotal },
    }).eq("id", job_id);

    // Self-chain
    supabase.functions.invoke("plugin-mcp-fetch", {
      body: { template_id, plugin_id, job_id, after_orgnr: lastOrgnr, running_total: newTotal },
    }).catch(() => {});

    return new Response(JSON.stringify({ inserted, last_orgnr: lastOrgnr, running_total: newTotal }), {
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
