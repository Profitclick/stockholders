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

    const body = await req.json().catch(() => ({}));
    const customWeights = body.weights ?? null;
    const afterId = body.after_id ?? null;
    const jobId = body.job_id ?? null;
    const runningTotal = body.running_total ?? 0;
    const isFirstCall = !afterId;

    // Create or reuse job
    let currentJobId = jobId;
    if (isFirstCall) {
      const { data: job } = await supabase
        .from("jobs")
        .insert({ type: "ias_scoring", status: "running", total_batches: 1 })
        .select("id")
        .single();
      currentJobId = job?.id;
    }

    // Score one batch
    const weights = {
      ...(customWeights ?? {}),
      _batch_size: 25000,
      ...(afterId ? { _after_id: afterId } : {}),
    };

    const { data, error } = await supabase.rpc("bulk_score_investors", {
      p_weights: weights,
    });

    if (error) throw new Error(`Scoring failed: ${error.message}`);

    const result = typeof data === "string" ? JSON.parse(data) : data;
    const batchScored = result?.scored ?? 0;
    const newTotal = runningTotal + batchScored;
    const done = result?.done || !result?.last_id;

    if (!done) {
      // Self-chain: invoke next batch
      const nextBody = {
        weights: customWeights,
        after_id: result.last_id,
        job_id: currentJobId,
        running_total: newTotal,
      };
      supabase.functions.invoke("ias-scoring", { body: nextBody }).catch(() => {});

      return new Response(JSON.stringify({ success: true, scored: newTotal, status: "running" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Done — finalize
    if (currentJobId) {
      await supabase.from("jobs").update({
        status: "completed",
        progress: 100,
        current_batch: 1,
        total_batches: 1,
      }).eq("id", currentJobId);
    }

    try { await supabase.rpc("refresh_pipeline_stats"); } catch { /* optional */ }

    await supabase.from("audit_log").insert({
      action: "ias_scoring_completed",
      entity_type: "job",
      entity_id: currentJobId,
      details: { scored: newTotal, weights: customWeights ?? "default" },
    });

    return new Response(JSON.stringify({ success: true, scored: newTotal }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("IAS scoring error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
