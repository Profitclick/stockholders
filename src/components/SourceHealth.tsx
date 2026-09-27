import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw } from "lucide-react";

interface SourceStatus {
  id: string;
  label: string;
  critical: boolean;
  status: "ok" | "degraded" | "throttled" | "down";
  http_status: number;
  latency_ms: number;
  error?: string;
}

interface HealthResponse {
  overall: "ok" | "degraded" | "down";
  checked_at: string;
  sources: SourceStatus[];
}

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  throttled: "bg-amber-500",
  down: "bg-destructive",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Tilgjengelig",
  degraded: "Ustabil",
  throttled: "Begrenset",
  down: "Nede",
};

export function SourceHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function check() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("source-health");
      if (error) throw error;
      setHealth(data as HealthResponse);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    check();
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg">Datakilder</CardTitle>
        <Button variant="ghost" size="sm" onClick={check} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        {!health && loading && <p className="text-sm text-muted-foreground">Sjekker kildene…</p>}
        {!health && !loading && (
          <p className="text-sm text-destructive">Kunne ikke sjekke kildene akkurat nå.</p>
        )}
        {health && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.sources.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_STYLES[s.status] ?? "bg-muted"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {STATUS_LABEL[s.status] ?? s.status} · {s.latency_ms} ms
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
