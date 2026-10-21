import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
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

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!userData?.user) return json({ error: "Ikke innlogget" }, 401);

    const { data: context, error } = await supabase.rpc("ownership_ai_context", { q: question });
    if (error) return json({ error: error.code === "42501" ? "Kun eier har tilgang" : error.message }, error.code === "42501" ? 403 : 500);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI er ikke konfigurert" }, 500);

    const { result } = createResponsesCall(
      req,
      { baseURL: "https://ai.gateway.lovable.dev/v1", apiKey, model: "openai/gpt-6-astra" },
      [{ role: "user", content: `Spørsmål: ${question}\n\nKontekst (JSON):\n${JSON.stringify(context)}` }],
      INSTRUCTIONS,
    );
    let answer = "";
    try {
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") answer += (part as any).text ?? (part as any).delta ?? "";
        if (part.type === "error") throw (part as any).error;
      }
    } catch (e: any) {
      const status = e?.statusCode ?? e?.status ?? 500;
      if (status === 429) return json({ error: "For mange forespørsler – prøv igjen om litt." }, 429);
      if (status === 402) return json({ error: "Tom for AI-kreditter. Fyll på under Settings → Plans & credits." }, 402);
      if (status === 403) return json({ error: e?.message ?? "AI-tilgang avvist" }, 403);
      return json({ error: e?.message ?? "AI-feil" }, status >= 400 && status < 600 ? status : 500);
    }
    if (!answer.trim()) return json({ error: "Modellen ga ikke noe svar." }, 502);
    const c = context as any;
    return json({ answer, matched_companies: (c?.company_matches ?? []).map((x: any) => ({ orgnr: x.orgnr, name: x.name })) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Ukjent feil" }, 500);
  }
});
