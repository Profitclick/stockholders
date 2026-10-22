// Admin-only bulk loader for the read-only platform exposure tables (rows produced offline by DuckDB).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const TABLES = ["custody_platforms", "company_platform_holdings", "nominee_accounts", "company_platform_profile", "platform_stats"];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Ikke innlogget" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser(auth.replace("Bearer ", ""));
  if (!u?.user) return json({ error: "Ikke innlogget" }, 401);
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  if (!isAdmin) return json({ error: "Kun eier" }, 403);

  const body = await req.json().catch(() => null);
  if (body?.action === "reset") {
    for (const t of TABLES) {
      const col = t === "custody_platforms" ? "id" : t === "platform_stats" ? "year" : t === "company_platform_profile" ? "orgnr" : t === "nominee_accounts" ? "id" : "year";
      const { error } = await admin.from(t).delete().not(col, "is", null);
      if (error) return json({ error: `${t}: ${error.message}` }, 500);
    }
    return json({ reset: true });
  }
  if (body?.action !== "insert" || !TABLES.includes(body.table)) return json({ error: "Ugyldig handling/tabell" }, 400);
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows || rows.length > 10000) return json({ error: "rows mangler eller for mange" }, 400);
  const { error } = await admin.from(body.table).insert(rows);
  if (error) return json({ error: error.message }, 500);
  return json({ inserted: rows.length });
});
