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

    const { segment_id, format: exportFormat = "csv", lead_optimized = false } = await req.json();

    if (!segment_id) {
      return new Response(JSON.stringify({ error: "segment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: segment } = await supabase
      .from("segments")
      .select("*")
      .eq("id", segment_id)
      .single();

    if (!segment) {
      return new Response(JSON.stringify({ error: "Segment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const investorIds = (segment.investor_ids as string[]) ?? [];
    if (investorIds.length === 0) {
      return new Response(JSON.stringify({ error: "No investors in segment" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch investors in batches
    const allInvestors: any[] = [];
    for (let i = 0; i < investorIds.length; i += 500) {
      const batch = investorIds.slice(i, i + 500);
      const { data } = await supabase.from("investors").select("*").in("id", batch);
      if (data) allInvestors.push(...data);
    }

    // If lead_optimized, also fetch company contact info
    let companyContacts: Record<string, any> = {};
    if (lead_optimized) {
      const orgnrs = new Set<string>();
      for (const inv of allInvestors) {
        const companies = Array.isArray(inv.portfolio_companies) ? inv.portfolio_companies : [];
        companies.forEach((c: any) => { if (c.orgnr) orgnrs.add(c.orgnr); });
      }
      if (orgnrs.size > 0) {
        const orgnrArr = [...orgnrs].slice(0, 500);
        const { data: companies } = await supabase
          .from("companies")
          .select("orgnr, name, email, phone, website, industry, size, address")
          .in("orgnr", orgnrArr);
        if (companies) {
          for (const c of companies) {
            companyContacts[c.orgnr] = c;
          }
        }
      }
    }

    let content: string;
    let contentType: string;

    if (exportFormat === "json") {
      content = JSON.stringify(allInvestors, null, 2);
      contentType = "application/json";
    } else {
      // CSV
      const headers = lead_optimized
        ? ["name", "type", "municipality", "region", "portfolio_size", "ias_score", "risk_score", "sector_score", "capital_score", "velocity_score", "capital_estimate", "top_company", "company_email", "company_phone", "company_website", "company_industry", "company_size"]
        : ["name", "type", "birth_year", "gender", "municipality", "region", "portfolio_size", "ias_score", "risk_score", "sector_score", "capital_score", "velocity_score", "capital_estimate"];

      const csvLines = [headers.join(",")];
      for (const inv of allInvestors) {
        const row: string[] = [];
        for (const h of headers) {
          if (h === "top_company") {
            const companies = Array.isArray(inv.portfolio_companies) ? inv.portfolio_companies : [];
            row.push(companies[0]?.name ?? "");
          } else if (h.startsWith("company_")) {
            const companies = Array.isArray(inv.portfolio_companies) ? inv.portfolio_companies : [];
            const topOrgnr = companies[0]?.orgnr;
            const contact = topOrgnr ? companyContacts[topOrgnr] : null;
            const field = h.replace("company_", "");
            row.push(contact?.[field] ?? "");
          } else {
            const val = inv[h];
            if (val == null) { row.push(""); continue; }
            const str = String(val);
            row.push(str.includes(",") ? `"${str}"` : str);
          }
        }
        csvLines.push(row.join(","));
      }
      content = csvLines.join("\n");
      contentType = "text/csv";
    }

    await supabase.from("exports_archive").insert({
      segment_id,
      profile_id: segment.profile_id,
      format: exportFormat,
      row_count: allInvestors.length,
      metadata: {
        segment_summary: segment.summary,
        lead_optimized,
        exported_at: new Date().toISOString(),
      },
    });

    await supabase.from("audit_log").insert({
      action: "segment_exported",
      entity_type: "segment",
      entity_id: segment_id,
      details: { format: exportFormat, row_count: allInvestors.length, lead_optimized },
    });

    return new Response(content, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="segment_${segment_id.slice(0, 8)}.${exportFormat === "json" ? "json" : "csv"}"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
