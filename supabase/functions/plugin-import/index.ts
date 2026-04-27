import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { rows, plugin_id, plugin_name, plugin_description, dataset_type, config, job_id, batch_index, total_batches } = body;

    if (!rows || !Array.isArray(rows) || !job_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // First batch: create or update the plugin record
    if (batch_index === 0 && plugin_name) {
      const existing = plugin_id
        ? (await supabase.from("plugins").select("id").eq("id", plugin_id).single()).data
        : null;

      if (existing) {
        await supabase.from("plugins").update({
          config: config || {},
          row_count: rows.length * total_batches,
        }).eq("id", plugin_id);
      } else {
        await supabase.from("plugins").insert({
          id: plugin_id,
          name: plugin_name,
          description: plugin_description || null,
          dataset_type: dataset_type || "plugin",
          config: config || {},
          row_count: rows.length * total_batches,
          enabled: true,
        });
      }
    }

    // Insert rows into plugin_data, extracting orgnr if present
    let errorsCount = 0;
    const SUB_BATCH = 1000;
    for (let i = 0; i < rows.length; i += SUB_BATCH) {
      const chunk = rows.slice(i, i + SUB_BATCH).map((row: Record<string, unknown>) => {
        const orgnr = (row.orgnr || row.Orgnr || row.ORGNR || row.org_nr || row.organisasjonsnummer || row.Organisasjonsnummer || "") as string;
        return {
          plugin_id,
          row_data: row,
          orgnr: orgnr ? String(orgnr).replace(/\s/g, "") : null,
        };
      });
      const { error } = await supabase.from("plugin_data").insert(chunk);
      if (error) {
        console.error("Insert error:", error);
        errorsCount += chunk.length;
      }
    }

    // Update job progress
    const progress = total_batches > 0 ? ((batch_index + 1) / total_batches) * 100 : 100;
    const isLast = batch_index + 1 >= total_batches;

    await supabase.from("jobs").update({
      current_batch: batch_index + 1,
      progress,
      errors_count: errorsCount,
      status: isLast ? "completed" : "running",
      ...(isLast ? { estimated_time_remaining: 0 } : {}),
    }).eq("id", job_id);

    // Log and audit on completion
    if (isLast) {
      const { count } = await supabase
        .from("plugin_data")
        .select("id", { count: "exact", head: true })
        .eq("plugin_id", plugin_id);

      await supabase.from("plugins").update({ row_count: count ?? 0 }).eq("id", plugin_id);

      // Auto cross-reference
      await supabase.rpc("cross_reference_plugin", { p_plugin_id: plugin_id });

      await supabase.from("plugin_logs").insert({
        plugin_id,
        action: "dataset_imported",
        details: { rows_imported: count, errors: errorsCount, job_id },
      });

      await supabase.from("audit_log").insert({
        action: "plugin_import_completed",
        entity_type: "plugin",
        entity_id: plugin_id,
        details: { plugin_name, total_rows: count, errors: errorsCount },
      });
    }

    return new Response(
      JSON.stringify({ success: true, inserted: rows.length, errors: errorsCount, progress }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Plugin import error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
