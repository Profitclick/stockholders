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
    const limit = body?.limit ?? 5000;

    // Call the detect_yoy_triggers function
    const { data, error } = await supabase.rpc("detect_yoy_triggers", { p_limit: limit });

    if (error) {
      throw new Error(`detect_yoy_triggers failed: ${error.message}`);
    }

    // Log to audit
    await supabase.from("audit_log").insert({
      action: "triggers_detected",
      entity_type: "system",
      details: data,
    });

    return new Response(JSON.stringify({ ok: true, results: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Trigger detection error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
