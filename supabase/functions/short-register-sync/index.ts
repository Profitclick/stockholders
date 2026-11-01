import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdmin } from "../_shared/requireAdmin.ts";

const SSR_URL = "https://ssr.finanstilsynet.no/api/v2/instruments";

type Event = { date: string; shortPercent: number; activePositions?: unknown[] };
type Instrument = { isin: string; issuerName: string; events?: Event[] };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const res = await fetch(SSR_URL, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
    if (!res.ok) return json({ error: "Finanstilsynet svarte ikke", status: res.status }, 502);
    const list = (await res.json()) as Instrument[];
    const now = new Date().toISOString();
    const rows = list.filter((i) => i.isin).map((i) => {
      const latest = [...(i.events ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0];
      return {
        isin: i.isin, issuer_name: i.issuerName,
        short_pct: latest?.shortPercent ?? 0, holders: latest?.activePositions?.length ?? 0,
        as_of: latest?.date?.slice(0, 10) ?? null, updated_at: now,
      };
    });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (rows.length) {
      const { error } = await db.from("short_positions").upsert(rows, { onConflict: "isin" });
      if (error) throw error;
    }
    return json({ instruments: rows.length, active: rows.filter((r) => r.short_pct > 0).length });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
