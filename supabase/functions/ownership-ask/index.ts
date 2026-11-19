import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GatewayError } from "npm:@lovable.dev/ai-gateway@0.1.11";
import { createResponsesCall } from "../_shared/responses.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const INSTRUCTIONS = `Du er analytiker for norske eierskapsdata (Aksjonærregisteret 2024 vs 2025).
Svar på norsk, kort og konkret, kun basert på JSON-konteksten du får. Ikke finn på tall.
Aldri nevn, gjett eller utled navn på privatpersoner – bare aggregater, selskaper, kommuner og bransjer.
Hvis konteksten ikke dekker spørsmålet, si det og foreslå hvordan spørsmålet kan presiseres (f.eks. org.nr., selskapsnavn eller kommune).
Bruk gjerne korte punktlister.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Ikke innlogget" }, 401);
    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length < 3 || question.length > 1000) return json({ error: "Spørsmålet må være 3–1000 tegn" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anonKey) return json({ error: "Datatilgang er ikke konfigurert" }, 500);
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!userData?.user) return json({ error: "Ikke innlogget" }, 401);

    const { data: context, error } = await supabase.rpc("ownership_ai_context", { q: question });
    if (error) return json({ error: error.code === "42501" ? "Kun eier har tilgang" : error.message }, error.code === "42501" ? 403 : 500);

    let answer = "";
    try {
      const result = await createResponsesCall(
        req,
        `Spørsmål: ${question}\n\nKontekst (JSON):\n${JSON.stringify(context)}`,
        INSTRUCTIONS,
      );
      for await (const part of result) {
        if (part.type === "response.output_text.delta") answer += part.delta;
      }
    } catch (e) {
      const status = e instanceof GatewayError ? e.httpStatus ?? 500 : 500;
      if (status === 429) return json({ error: "For mange forespørsler – prøv igjen om litt." }, 429);
      if (status === 402) return json({ error: "Tom for AI-kreditter. Fyll på under Settings → Plans & credits." }, 402);
      if (status === 403) return json({ error: e instanceof Error ? e.message : "AI-tilgang avvist" }, 403);
      return json({ error: e instanceof Error ? e.message : "AI-feil" }, status >= 400 && status < 600 ? status : 500);
    }
    if (!answer.trim()) return json({ error: "Modellen ga ikke noe svar." }, 502);
    const c = context as any;
    return json({ answer, matched_companies: (c?.company_matches ?? []).map((x: any) => ({ orgnr: x.orgnr, name: x.name })) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Ukjent feil" }, 500);
  }
});
