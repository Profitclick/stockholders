// Admin-only bulk loader for person_ownership_history (rows produced offline by DuckDB).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  // Full rebuild support: delete an id window [from, to) before reloading all years.
  if (body?.action === "delete_range") {
    const from = Number(body.from), to = Number(body.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to - from > 500000) return json({ error: "ugyldig intervall" }, 400);
    const { error, count } = await admin.from("person_ownership_history").delete({ count: "exact" }).gte("id", from).lt("id", to);
    if (error) return json({ error: error.message }, 500);
    return json({ deleted: count ?? 0 });
  }
  if (body?.action === "refresh_signals") {
    const from = String(body.from ?? ""), to = String(body.to ?? "");
    if (!/^\d{1,9}$/.test(from) || !/^\d{1,10}$/.test(to)) return json({ error: "ugyldig orgnr-intervall" }, 400);
    const { data, error } = await admin.rpc("refresh_historical_ownership_signals_range", { p_from: from, p_to: to });
    if (error) return json({ error: error.message }, 500);
    return json({ refreshed: data });
  }
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || rows.length > 10000) return json({ error: "rows mangler eller for mange" }, 400);
  const { error } = await admin.from("person_ownership_history").insert(rows);
  if (error) return json({ error: error.message }, 500);
  return json({ inserted: rows.length });
});
