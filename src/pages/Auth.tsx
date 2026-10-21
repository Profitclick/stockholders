import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Auth() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && session) return <Navigate to="/eiere" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error("Innlogging feilet: " + error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + "/eiere" },
      });
      if (error) toast.error("Registrering feilet: " + error.message);
      else if (!data.session) toast.success("Sjekk e-posten din og bekreft kontoen.");
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "in" ? "Logg inn" : "Opprett eierkonto"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Kun eieren av appen får tilgang til lister med navngitte personer.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">E-post</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pw">Passord</Label>
              <Input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {mode === "in" ? "Logg inn" : "Registrer"}
            </Button>
            <button type="button" className="text-xs text-muted-foreground underline w-full" onClick={() => setMode(mode === "in" ? "up" : "in")}>
              {mode === "in" ? "Første gang? Opprett konto" : "Har konto? Logg inn"}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
