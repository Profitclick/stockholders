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

    const { seed_companies, limit } = await req.json();

    if (!seed_companies || !Array.isArray(seed_companies) || seed_companies.length === 0) {
      return new Response(JSON.stringify({ error: "seed_companies array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build seed profile from uploaded customer data
    const industries: Record<string, number> = {};
    const municipalities: Record<string, number> = {};
    const types: Record<string, number> = {};
    let totalCapital = 0;
    let capitalCount = 0;
    const portfolioSizes: number[] = [];

    for (const c of seed_companies) {
      const industry = c.industry || c.bransje || c.nace || c.NACE || c.Industry || "";
      const muni = c.municipality || c.kommune || c.Municipality || c.poststed || c.Poststed || "";
      const type = c.type || c.org_form || c.organisasjonsform || c.Type || "";
      const cap = parseFloat(c.capital || c.revenue || c.omsetning || c.Omsetning || "0") || 0;
      const ps = parseInt(c.employees || c.ansatte || c.Ansatte || "0") || 0;

      if (industry) industries[industry] = (industries[industry] || 0) + 1;
      if (muni) municipalities[muni] = (municipalities[muni] || 0) + 1;
      if (type) types[type] = (types[type] || 0) + 1;
      if (cap > 0) { totalCapital += cap; capitalCount++; }
      if (ps > 0) portfolioSizes.push(ps);
    }

    const topN = (obj: Record<string, number>, n: number) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

    const seedProfile = {
      name: `Lookalike (${seed_companies.length} seed companies)`,
      industries: topN(industries, 10),
      municipalities: topN(municipalities, 15),
      entity_types: topN(types, 5),
      min_portfolio_size: portfolioSizes.length ? Math.min(...portfolioSizes) : 0,
      max_portfolio_size: portfolioSizes.length ? Math.max(...portfolioSizes) : 1000,
      min_capital: capitalCount > 0 ? (totalCapital / capitalCount) * 0.3 : 0,
      max_capital: capitalCount > 0 ? (totalCapital / capitalCount) * 3 : 999999999,
      seed_size: seed_companies.length,
    };

    const { data: result, error } = await supabase.rpc("generate_lookalike_segment", {
      p_seed_profile: seedProfile,
      p_limit: limit || 500,
    });

    if (error) throw new Error(`Lookalike generation failed: ${error.message}`);

    return new Response(JSON.stringify({ ...result, seed_profile: seedProfile }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Lookalike error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
