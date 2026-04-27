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
      .select("id, address, name, orgnr")
      .is("geo_context", null)
      .not("address", "is", null)
      .limit(1000);

    if (!companies || companies.length === 0) {
      return new Response(JSON.stringify({ message: "No companies to geocode" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalBatches = Math.ceil(companies.length / BATCH_SIZE);
    const { data: job } = await supabase
      .from("jobs")
      .insert({ type: "geonorge_enrichment", status: "running", total_batches: totalBatches })
      .select("id")
      .single();
    const jobId = job?.id;

    let enriched = 0;
    let errors = 0;

    for (let b = 0; b < totalBatches; b++) {
      const batch = companies.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

      for (const company of batch) {
        try {
          const searchTerm = encodeURIComponent(company.address || company.name);
          const res = await fetch(
            `https://ws.geonorge.no/adresser/v1/sok?sok=${searchTerm}&fuzzy=true&treffPerSide=1`
          );
          if (!res.ok) { errors++; continue; }
          const data = await res.json();
          const hit = data.adresser?.[0];

          const geoContext = hit ? {
            address_text: hit.adressetekst,
            municipality_name: hit.kommunenavn,
            municipality_code: hit.kommunenummer,
            lat: hit.representasjonspunkt?.lat,
            lng: hit.representasjonspunkt?.lon,
            postal_code: hit.postnummer,
            postal_name: hit.poststed,
            source: "geonorge",
            fetched_at: new Date().toISOString(),
          } : { source: "geonorge", fetched_at: new Date().toISOString(), note: "No match" };

          await supabase.from("companies").update({ geo_context: geoContext }).eq("id", company.id);
          enriched++;
        } catch {
          errors++;
        }
      }

      if (jobId) {
        await supabase.from("jobs").update({
          current_batch: b + 1,
          progress: ((b + 1) / totalBatches) * 100,
          errors_count: errors,
          status: b + 1 >= totalBatches ? "completed" : "running",
        }).eq("id", jobId);
      }
    }

    await supabase.from("audit_log").insert({
      action: "geonorge_enrichment_completed",
      entity_type: "job",
      entity_id: jobId,
      details: { enriched, errors },
    });

    return new Response(JSON.stringify({ success: true, enriched, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Geonorge enrichment error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
