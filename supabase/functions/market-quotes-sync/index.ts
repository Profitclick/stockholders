import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdmin } from "../_shared/requireAdmin.ts";

const EURONEXT_URL = "https://live.euronext.com/en/pd_es/data/stocks/download?mics=XOSL%2CMERK%2CXOAS";

/** Mirrors SQL normalize_company_name. */
const norm = (s: string) =>
  s.toUpperCase().replace(/\s+(AS|ASA|ANS|DA|SA|BA|NUF|KS|AB|A\/S)\.?$/, "").replace(/[^A-ZÆØÅ0-9 ]/g, "").replace(/\s+/g, " ").trim();

const num = (s?: string) => {
  if (!s || s === "-") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function parseCsv(text: string) {
  const rows: Record<string, string>[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/).slice(4)) {
    const cells = line.split(";").map((c) => c.replace(/^"|"$/g, "").trim());
    if (cells.length < 14 || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cells[1])) continue;
    rows.push({ name: cells[0], isin: cells[1], symbol: cells[2], market: cells[3], currency: cells[4], last: cells[8], volume: cells[11], turnover: cells[12], close: cells[13] });
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const res = await fetch(EURONEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
      body: "args%5BinitialLetter%5D=&iDisplayLength=3000&iDisplayStart=0",
    });
    const text = await res.text();
    if (!res.ok) return json({ error: "Euronext svarte ikke", status: res.status, details: text.slice(0, 300) }, 502);
    const header = text.split(/\r?\n/).slice(0, 3).join(" ");
    const quoteDate = header.match(/\d{1,2} \w{3} \d{4}/)?.[0] ?? null;
    const listings = parseCsv(text);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const byName = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("company_platform_profile").select("orgnr,company_name").eq("vps_registered", true).order("orgnr").range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) if (r.company_name) byName.set(norm(r.company_name), r.orgnr);
      if (!data || data.length < 1000) break;
    }

    const now = new Date().toISOString();
    const matched = new Map<string, Record<string, unknown>>();
    const unmatched: string[] = [];
    for (const l of listings) {
      const orgnr = byName.get(norm(l.name));
      if (!orgnr) { unmatched.push(l.name); continue; }
      matched.set(orgnr, {
        orgnr, isin: l.isin, symbol: l.symbol, market: l.market, currency: l.currency, listed_name: l.name,
        last_price: num(l.last) ?? num(l.close), volume: num(l.volume), turnover: num(l.turnover), quote_date: quoteDate, updated_at: now,
      });
    }
    const rows = [...matched.values()];
    if (rows.length) {
      const { error } = await db.from("market_quotes").upsert(rows, { onConflict: "orgnr" });
      if (error) throw error;
    }
    return json({ listings: listings.length, matched: rows.length, unmatched: unmatched.length, quote_date: quoteDate });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
