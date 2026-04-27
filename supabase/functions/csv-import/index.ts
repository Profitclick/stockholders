import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10000;

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
    const { rows, column_mapping, dataset_type, job_id, batch_index, total_batches } = body;

    if (!rows || !Array.isArray(rows) || !column_mapping || !job_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Map columns and build insert rows
    let errorsCount = 0;
    let warningsCount = 0;
    const mapped: Record<string, unknown>[] = [];

    for (const row of rows) {
      try {
        const record: Record<string, unknown> = {
          import_job_id: job_id,
          dataset_type: dataset_type || "shareholder",
        };

        for (const [csvCol, dbCol] of Object.entries(column_mapping)) {
          if (!dbCol || dbCol === "__skip__") continue;
          let val = row[csvCol as string];
          if (val === "" || val === undefined || val === null) {
            record[dbCol as string] = null;
            continue;
          }
          // Type coercion for numeric fields
          if (["birth_year", "shares", "year"].includes(dbCol as string)) {
            const num = parseInt(String(val), 10);
            if (isNaN(num)) {
              warningsCount++;
              record[dbCol as string] = null;
            } else {
              record[dbCol as string] = num;
            }
          } else {
            record[dbCol as string] = String(val).trim();
          }
        }

        mapped.push(record);
      } catch {
        errorsCount++;
      }
    }

    // Insert in sub-batches of 1000 to avoid payload limits
    const SUB_BATCH = 1000;
    for (let i = 0; i < mapped.length; i += SUB_BATCH) {
      const chunk = mapped.slice(i, i + SUB_BATCH);
      const { error } = await supabase.from("shareholder_raw").insert(chunk);
      if (error) {
        console.error("Insert error:", error);
        errorsCount += chunk.length;
      }
    }

    // Update job progress
    const progress = total_batches > 0 ? ((batch_index + 1) / total_batches) * 100 : 100;
    const isLast = batch_index + 1 >= total_batches;

    await supabase
      .from("jobs")
      .update({
        current_batch: batch_index + 1,
        progress,
        errors_count: errorsCount,
        warnings_count: warningsCount,
        status: isLast ? "completed" : "running",
        ...(isLast ? { estimated_time_remaining: 0 } : {}),
      })
      .eq("id", job_id);

    // Audit log
    if (isLast) {
      await supabase.from("audit_log").insert({
        action: "csv_import_completed",
        entity_type: "job",
        entity_id: job_id,
        details: {
          total_rows: rows.length * total_batches,
          errors: errorsCount,
          warnings: warningsCount,
          dataset_type,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: mapped.length,
        errors: errorsCount,
        warnings: warningsCount,
        progress,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("CSV import error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
