import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles } from "lucide-react";

const EXAMPLES = [
  "Hvilke kommuner har flest majoritetseierskifter fra 2024 til 2025?",
  "Hvordan har eierskapet i Equinor ASA utviklet seg?",
  "Hvilke aldersgrupper av personeiere har gått mest ut av selskaper?",
];

export default function OwnershipAsk() {
  const { session, isAdmin, loading } = useAuth();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [matches, setMatches] = useState<{ orgnr: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <p className="text-sm text-muted-foreground">Laster…</p>;
  if (!session || !isAdmin)
    return (
      <Card className="max-w-lg">
        <CardContent className="pt-6 space-y-3">
          <p className="text-sm">Denne funksjonen er kun for eieren.</p>
          <Button asChild size="sm"><Link to="/auth">Logg inn</Link></Button>
        </CardContent>
      </Card>
    );

  async function ask() {
    if (question.trim().length < 3 || busy) return;
    setBusy(true); setError(null); setAnswer(null); setMatches([]);
    const { data, error } = await supabase.functions.invoke("ownership-ask", { body: { question } });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as any).context?.json())?.error ?? msg; } catch { /* ignore */ }
      setError(msg);
    } else if (data?.error) setError(data.error);
    else { setAnswer(data.answer); setMatches(data.matched_companies ?? []); }
    setBusy(false);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Sparkles className="h-5 w-5" />Spør om eierutvikling</h1>
        <p className="text-sm text-muted-foreground">AI-drevet oppsummering av aggregerte endringer 2024→2025. Personnavn vises aldri.</p>
      </div>
      <Textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="F.eks. «Hva har skjedd med eierskapet i selskaper i Bergen?»"
        maxLength={1000}
        rows={3}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); }}
      />
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <Button key={ex} variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={() => setQuestion(ex)}>{ex}</Button>
        ))}
      </div>
      <Button onClick={ask} disabled={busy || question.trim().length < 3}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Spør
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {answer && (
        <Card>
          <CardHeader><CardTitle className="text-base">Svar</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm whitespace-pre-wrap leading-relaxed">{answer}</div>
            {matches.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {matches.map((m) => <Badge key={m.orgnr} variant="secondary">{m.name} · {m.orgnr}</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
