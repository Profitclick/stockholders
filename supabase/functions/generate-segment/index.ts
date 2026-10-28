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

    const { profile_id } = await req.json();
    if (!profile_id) {
      return new Response(JSON.stringify({ error: "profile_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profile_id)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const thresholds = (profile.thresholds as any) ?? {};
    const rules = (profile.rules as any) ?? {};
    const minScore = thresholds.min_score ?? 0;

    // Create job
    const { data: job } = await supabase
      .from("jobs")
      .insert({ type: "segment_generation", status: "running", total_batches: 1 })
      .select("id")
      .single();

    // Fetch all investors above score threshold
    let query = supabase
      .from("investors")
      .select("*")
      .gte("ias_score", minScore)
      .order("ias_score", { ascending: false });

    // Apply rules filters
    if (rules.entity_types && Array.isArray(rules.entity_types) && rules.entity_types.length > 0) {
      query = query.in("type", rules.entity_types);
    }
    if (rules.min_portfolio_size) {
      query = query.gte("portfolio_size", rules.min_portfolio_size);
    }
    if (rules.max_portfolio_size) {
      query = query.lte("portfolio_size", rules.max_portfolio_size);
    }
    if (rules.municipalities && Array.isArray(rules.municipalities) && rules.municipalities.length > 0) {
      query = query.in("municipality", rules.municipalities);
    }

    const { data: investors } = await query.limit(5000);
    const matchedInvestors = investors ?? [];

    // Build summary
    const investorIds = matchedInvestors.map((i) => i.id);
    const scores = matchedInvestors.map((i) => (i as any).ias_score ?? 0);
    const avgScore = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;

    // Type distribution
    const typeDistribution: Record<string, number> = {};
    matchedInvestors.forEach((i) => {
      const t = (i as any).type ?? "unknown";
      typeDistribution[t] = (typeDistribution[t] || 0) + 1;
    });

    // Municipality distribution (top 10)
    const muniDistribution: Record<string, number> = {};
    matchedInvestors.forEach((i) => {
      const m = (i as any).municipality ?? "unknown";
      muniDistribution[m] = (muniDistribution[m] || 0) + 1;
    });
    const topMunicipalities = Object.entries(muniDistribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

    // Score histogram (10 buckets)
    const histogram = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}-${(i + 1) * 10}`,
      count: scores.filter((s) => s >= i * 10 && s < (i + 1) * 10).length,
    }));

    const summary = {
      total_investors: matchedInvestors.length,
      avg_score: Math.round(avgScore * 10) / 10,
      min_score: scores.length > 0 ? Math.min(...scores) : 0,
      max_score: scores.length > 0 ? Math.max(...scores) : 0,
      type_distribution: typeDistribution,
      top_municipalities: topMunicipalities,
      score_histogram: histogram,
      profile_name: profile.name,
    };

    // Create segment
    const { data: segment } = await supabase
      .from("segments")
      .insert({
        profile_id,
        investor_ids: investorIds,
        summary,
      })
      .select("id")
      .single();

    // Update job
    if (job) {
      await supabase.from("jobs").update({
        current_batch: 1,
        progress: 100,
        status: "completed",
      }).eq("id", job.id);
    }

    await supabase.from("audit_log").insert({
      action: "segment_generated",
      entity_type: "segment",
      entity_id: segment?.id,
      details: { profile_id, investor_count: matchedInvestors.length, avg_score: avgScore },
    });

    return new Response(JSON.stringify({
      success: true,
      segment_id: segment?.id,
      summary,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Segment generation error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
