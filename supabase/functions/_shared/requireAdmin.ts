import { createClient } from "npm:@supabase/supabase-js@2";

/** Returns null when the caller is an admin, otherwise a 401/403 Response. */
export async function requireAdmin(req: Request, headers: Record<string, string>): Promise<Response | null> {
  const deny = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...headers, "Content-Type": "application/json" } });
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return deny(401, "Ikke innlogget");
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await userClient.auth.getClaims(auth.slice(7));
  const userId = data?.claims?.sub;
  if (error || !userId) return deny(401, "Ikke innlogget");
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) return deny(403, "Kun eier");
  return null;
}
