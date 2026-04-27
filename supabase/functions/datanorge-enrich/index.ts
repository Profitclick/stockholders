import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: companies } = await supabase
      .from("companies")
      .select("id, industry, name")
      .not("industry", "is", null)
      .limit(1000);

    if (!companies || companies.length === 0) {
      return new Response(JSON.stringify({ message: "No companies to enrich" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get unique industries
    const industries = [...new Set(companies.map(c => c.industry).filter(Boolean))];
    const totalBatches = industries.length;

    const { data: job } = await supabase
      .from("jobs")
      .insert({ type: "datanorge_enrichment", status: "running", total_batches: totalBatches })
      .select("id")
      .single();
    const jobId = job?.id;

    let enriched = 0;
    let errors = 0;
    const industryData: Record<string, any> = {};

    for (let i = 0; i < industries.length; i++) {
      const industry = industries[i];
      try {
        const searchTerm = encodeURIComponent(industry!);
        const res = await fetch(
          `https://data.norge.no/api/dcat/search?q=${searchTerm}&size=5`
        );
        if (!res.ok) { errors++; continue; }
        const data = await res.json();

        industryData[industry!] = {
          datasets_found: data.hits?.total?.value ?? 0,
          top_datasets: (data.hits?.hits ?? []).slice(0, 3).map((hit: any) => ({
            title: hit._source?.title?.nb ?? hit._source?.title?.en ?? "Unknown",
            description: (hit._source?.description?.nb ?? hit._source?.description?.en ?? "").slice(0, 200),
            publisher: hit._source?.publisher?.name,
          })),
          source: "data.norge.no",
          fetched_at: new Date().toISOString(),
        };
        enriched++;
      } catch {
        errors++;
      }

      if (jobId) {
        await supabase.from("jobs").update({
          current_batch: i + 1,
          progress: ((i + 1) / totalBatches) * 100,
          errors_count: errors,
          status: i + 1 >= totalBatches ? "completed" : "running",
        }).eq("id", jobId);
      }
    }

    // Update companies with their industry's data.norge context
    for (const company of companies) {
      if (company.industry && industryData[company.industry]) {
        await supabase.from("companies").update({
          datanorge_context: industryData[company.industry],
        }).eq("id", company.id);
      }
    }

    await supabase.from("audit_log").insert({
      action: "datanorge_enrichment_completed",
      entity_type: "job",
      entity_id: jobId,
      details: { industries_processed: enriched, errors },
    });

    return new Response(JSON.stringify({ success: true, enriched, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("data.norge.no enrichment error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
