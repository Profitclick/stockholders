import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;

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
    const { job_id, orgnrs, limit: reqLimit } = body;
    const fetchLimit = Math.min(reqLimit ?? 50, 200);

    let query = supabase.from("companies").select("id, orgnr").eq("enriched", false).limit(fetchLimit);
    if (orgnrs && Array.isArray(orgnrs) && orgnrs.length > 0) {
      query = supabase.from("companies").select("id, orgnr").in("orgnr", orgnrs).limit(fetchLimit);
    }

    const { data: companies, error } = await query;

    if (error || !companies || companies.length === 0) {
      return new Response(JSON.stringify({ message: "No companies to enrich", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalBatches = Math.ceil(companies.length / BATCH_SIZE);
    let jobId = job_id;
    if (!jobId) {
      const { data: job } = await supabase
        .from("jobs")
        .insert({ type: "brreg_enrichment", status: "running", total_batches: totalBatches })
        .select("id")
        .single();
      jobId = job?.id;
    }

    let enriched = 0;
    let errors = 0;

    for (let b = 0; b < totalBatches; b++) {
      const batch = companies.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

      for (const company of batch) {
        try {
          // Main Enhetsregisteret
          const res = await fetch(
            `https://data.brreg.no/enhetsregisteret/api/enheter/${company.orgnr}`
          );

          if (!res.ok) { errors++; continue; }
          const data = await res.json();

          const industry = data.naeringskode1?.beskrivelse ?? null;
          const size = data.antallAnsatte != null
            ? data.antallAnsatte <= 10 ? "micro"
              : data.antallAnsatte <= 50 ? "small"
              : data.antallAnsatte <= 250 ? "medium"
              : "large"
            : null;

          // Extract contact info
          const email = data.epostadresse ?? null;
          const phone = data.telefonnummer ?? null;
          const website = data.hjemmeside ?? null;
          const address = data.forretningsadresse
            ? [data.forretningsadresse.adresse?.[0], data.forretningsadresse.postnummer, data.forretningsadresse.poststed].filter(Boolean).join(", ")
            : null;

          // Try Frivillighetsregisteret
          let frivilligData = null;
          try {
            const fRes = await fetch(
              `https://data.brreg.no/frivillighetsregisteret/api/organisasjoner/${company.orgnr}`
            );
            if (fRes.ok) {
              frivilligData = await fRes.json();
            }
          } catch { /* optional */ }

          // Try Roller (roles)
          let rolesData = null;
          try {
            const rRes = await fetch(
              `https://data.brreg.no/enhetsregisteret/api/enheter/${company.orgnr}/roller`
            );
            if (rRes.ok) {
              const rData = await rRes.json();
              rolesData = (rData.rollegrupper ?? []).map((g: any) => ({
                type: g.type?.beskrivelse,
                roles: (g.roller ?? []).map((r: any) => ({
                  name: r.person?.navn?.fornavn ? `${r.person.navn.fornavn} ${r.person.navn.etternavn}` : r.enhet?.organisasjonsnummer,
                  title: r.type?.beskrivelse,
                })),
              }));
            }
          } catch { /* optional */ }

          await supabase.from("companies").update({
            industry,
            size,
            enriched: true,
            email,
            phone,
            website,
            address,
            brreg_data: {
              organisasjonsform: data.organisasjonsform?.beskrivelse,
              naeringskode1: data.naeringskode1,
              antallAnsatte: data.antallAnsatte,
              forretningsadresse: data.forretningsadresse,
              stiftelsesdato: data.stiftelsesdato,
              registrertIMvaregisteret: data.registrertIMvaregisteret,
              registreringsdatoEnhetsregisteret: data.registreringsdatoEnhetsregisteret,
              frivillig: frivilligData ? { category: frivilligData.aktivitet, registered: true } : null,
              roles: rolesData,
            },
          }).eq("id", company.id);

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
      action: "brreg_enrichment_completed",
      entity_type: "job",
      entity_id: jobId,
      details: { enriched, errors, total: companies.length },
    });

    return new Response(JSON.stringify({ success: true, enriched, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Brreg enrichment error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
