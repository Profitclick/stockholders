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

    const { data: investors } = await supabase
      .from("investors")
      .select("id, municipality")
      .not("municipality", "is", null)
      .limit(1000);

    if (!investors || investors.length === 0) {
      return new Response(JSON.stringify({ message: "No investors with municipality data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const municipalities = [...new Set(investors.map((i) => i.municipality).filter(Boolean))];
    const { data: job } = await supabase
      .from("jobs")
      .insert({ type: "ssb_enrichment", status: "running", total_batches: municipalities.length })
      .select("id")
      .single();
    const jobId = job?.id;
    let enriched = 0;
    let errors = 0;

    for (let i = 0; i < municipalities.length; i++) {
      const muni = municipalities[i];
      try {
        // SSB population table 07459
        const ssbUrl = "https://data.ssb.no/api/v0/no/table/07459";
        let populationData = null;
        try {
          const popRes = await fetch(ssbUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: [{ code: "Region", selection: { filter: "item", values: [] } }],
              response: { format: "json-stat2" },
            }),
          });
          if (popRes.ok) {
            populationData = await popRes.json();
          }
        } catch { /* SSB may not respond */ }

        // SSB income table 06944
        let incomeData = null;
        try {
          const incRes = await fetch("https://data.ssb.no/api/v0/no/table/06944", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: [{ code: "Region", selection: { filter: "item", values: [] } }],
              response: { format: "json-stat2" },
            }),
          });
          if (incRes.ok) {
            incomeData = await incRes.json();
          }
        } catch { /* optional */ }

        // SSB employment table 13470
        let employmentData = null;
        try {
          const empRes = await fetch("https://data.ssb.no/api/v0/no/table/13470", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: [{ code: "Region", selection: { filter: "item", values: [] } }],
              response: { format: "json-stat2" },
            }),
          });
          if (empRes.ok) {
            employmentData = await empRes.json();
          }
        } catch { /* optional */ }

        const ssbContext = {
          municipality: muni,
          source: "ssb_pxweb",
          fetched_at: new Date().toISOString(),
          tables_queried: ["07459", "06944", "13470"],
          has_population: !!populationData,
          has_income: !!incomeData,
          has_employment: !!employmentData,
        };

        await supabase.from("investors").update({ ssb_context: ssbContext }).eq("municipality", muni);
        enriched++;
      } catch {
        errors++;
      }

      if (jobId) {
        await supabase.from("jobs").update({
          current_batch: i + 1,
          progress: ((i + 1) / municipalities.length) * 100,
          errors_count: errors,
          status: i + 1 >= municipalities.length ? "completed" : "running",
        }).eq("id", jobId);
      }
    }

    await supabase.from("audit_log").insert({
      action: "ssb_enrichment_completed",
      entity_type: "job",
      entity_id: jobId,
      details: { municipalities_processed: enriched, errors },
    });

    return new Response(JSON.stringify({ success: true, enriched, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("SSB enrichment error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
