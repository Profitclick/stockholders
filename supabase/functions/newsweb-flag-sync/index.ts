import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { requireAdmin } from "../_shared/requireAdmin.ts";

// Oslo Børs NewsWeb open API, category 1006 = FLAGGING (major shareholdings notification)
const LIST = "https://api3.oslo.oslobors.no/v1/newsreader/list";

type Msg = { messageId: number; issuerSign?: string; issuerName?: string; title?: string; publishedTime?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireAdmin(req, corsHeaders);
  if (denied) return denied;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 90 * 864e5);
    const d = (x: Date) => x.toISOString().slice(0, 10);
    const res = await fetch(`${LIST}?category=1006&issuer=&fromDate=${d(from)}&toDate=${d(to)}&market=&messageTitle=`, { method: "POST", headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return json({ error: "NewsWeb svarte ikke", status: res.status }, 502);
    const msgs = ((await res.json())?.data?.messages ?? []) as Msg[];
    const now = new Date().toISOString();
    const rows = msgs.filter((m) => m.messageId).map((m) => ({
      message_id: m.messageId, issuer_sign: m.issuerSign ?? null, issuer_name: m.issuerName ?? null,
      title: m.title ?? null, published_time: m.publishedTime ?? null, updated_at: now,
    }));
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (rows.length) {
      const { error } = await db.from("newsweb_flags").upsert(rows, { onConflict: "message_id" });
      if (error) throw error;
    }
    return json({ messages: rows.length, issuers: new Set(rows.map((r) => r.issuer_sign)).size, from: d(from) });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
