import { createClient } from "npm:@supabase/supabase-js@2";
import { requireAdmin } from "../_shared/requireAdmin.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { rows, job_id, target_table, batch_index, total_batches, column_mapping, parquet_import_id } = await req.json();

    if (!rows || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: "rows array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const table = target_table === "business_raw" ? "business_raw" : "shareholder_raw";
    let inserted = 0;
    let errors = 0;

    // Process in sub-batches of 1000
    const SUB_BATCH = 1000;
    for (let i = 0; i < rows.length; i += SUB_BATCH) {
      const chunk = rows.slice(i, i + SUB_BATCH);
      const mapped = chunk.map((row: any) => {
        const out: any = {};
        if (column_mapping) {
          for (const [srcCol, destCol] of Object.entries(column_mapping)) {
            if (destCol && row[srcCol] !== undefined) {
              out[destCol as string] = row[srcCol];
            }
          }
        } else {
          Object.assign(out, row);
        }
        if (job_id) out.import_job_id = job_id;
        if (table === "shareholder_raw" && !out.dataset_type) {
          out.dataset_type = "shareholder";
        }
        // Preserve as_of_year from payload or row data
        if (table === "shareholder_raw") {
          if (!out.as_of_year && row.as_of_year) out.as_of_year = Number(row.as_of_year);
          if (!out.as_of_year && out.year) out.as_of_year = Number(out.year);
        }
        return out;
      });

      const { error } = await supabase.from(table).insert(mapped);
      if (error) {
        console.error("Insert error:", error.message);
        errors += chunk.length;
      } else {
        inserted += chunk.length;
      }
    }

    // Update job progress
    if (job_id && batch_index !== undefined) {
      const progress = ((batch_index + 1) / (total_batches || 1)) * 100;
      const status = batch_index + 1 >= (total_batches || 1) ? "completed" : "running";
      await supabase.from("jobs").update({
        current_batch: batch_index + 1,
        progress,
        errors_count: errors,
        status,
      }).eq("id", job_id);
    }

    // Update parquet_imports
    if (parquet_import_id && batch_index + 1 >= (total_batches || 1)) {
      await supabase.from("parquet_imports").update({
        status: "completed",
        row_count: inserted,
      }).eq("id", parquet_import_id);
    }

    return new Response(JSON.stringify({ inserted, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Parquet import error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
