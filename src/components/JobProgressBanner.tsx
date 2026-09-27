import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2 } from "lucide-react";

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number;
  current_batch: number;
  total_batches: number;
  errors_count: number;
  created_at: string;
  updated_at: string;
  metadata: any;
}

const LABELS: Record<string, string> = {
  mcp_enrichment: "Berikelse av selskaper",
  ias_scoring: "Scoring av investorer",
  data_cleanup: "Opprydding i data",
  aggregation: "Aggregering",
  csv_import: "CSV-import",
  parquet_import: "Parquet-import",
};

function labelFor(type: string): string {
  if (LABELS[type]) return LABELS[type];
  if (type.startsWith("mcp_fetch:")) return `Henter ${type.slice("mcp_fetch:".length)}`;
  if (type.startsWith("plugin_import:")) return `Import: ${type.slice("plugin_import:".length)}`;
  return type;
}

function processedCount(job: Job): number {
  const m = job.metadata ?? {};
  return (
    m.enriched ??
    m.processed ??
    m.companies_processed ??
    m.investors_processed ??
    m.rows_processed ??
    m.total_fetched ??
    0
  );
}

function totalCount(job: Job): number {
  const m = job.metadata ?? {};
  const explicit = m.total ?? m.total_rows ?? m.total_companies ?? 0;
  if (explicit > 0) return explicit;
  const batchSize = m.batch_size ?? 0;
  if (job.total_batches > 0 && batchSize > 0) return job.total_batches * batchSize;
  return 0;
}

function percentFor(job: Job): number {
  const done = processedCount(job);
  const total = totalCount(job);
  if (total > 0) return Math.min(100, (done / total) * 100);
  if (job.progress > 0) return job.progress;
  if (job.total_batches > 0) return Math.min(100, (job.current_batch / job.total_batches) * 100);
  return 0;
}

function etaText(job: Job, pct: number): string | null {
  const done = processedCount(job);
  const total = totalCount(job);
  if (!total || done <= 0 || pct >= 100) return null;
  const elapsedMs = Date.now() - new Date(job.created_at).getTime();
  if (elapsedMs < 10000) return null;
  const msPerItem = elapsedMs / done;
  const remainingMs = msPerItem * (total - done);
  const min = Math.round(remainingMs / 60000);
  if (min < 1) return "under 1 min igjen";
  if (min < 60) return `ca. ${min} min igjen`;
  const h = Math.floor(min / 60);
  return `ca. ${h} t ${min % 60} min igjen`;
}

export function JobProgressBanner() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      try {
        const { data, error } = await supabase
          .from("jobs")
          .select("*")
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(5);
        if (!cancelled && !error) {
          setJobs((data as unknown as Job[]) ?? []);
          setLastUpdate(new Date());
          activeRef.current = ((data as unknown as Job[]) ?? []).length > 0;
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        timeoutId = setTimeout(poll, activeRef.current ? 3000 : 15000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  if (jobs.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" />
          Ingen prosesser kjører nå.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="space-y-5 py-5">
        {jobs.map((job) => {
          const pct = percentFor(job);
          const done = processedCount(job);
          const total = totalCount(job);
          const eta = etaText(job, pct);
          return (
            <div key={job.id} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {LABELS[job.type] ?? job.type}
                </span>
                <span className="text-sm font-semibold tabular-nums">{pct.toFixed(1)}%</span>
              </div>
              <Progress value={pct} className="h-3" />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {total > 0 ? (
                  <span>
                    {done.toLocaleString("nb-NO")} av {total.toLocaleString("nb-NO")} behandlet
                  </span>
                ) : (
                  done > 0 && <span>{done.toLocaleString("nb-NO")} behandlet</span>
                )}
                {eta && <span>{eta}</span>}
                {job.errors_count > 0 && <span className="text-destructive">{job.errors_count} feil</span>}
                {lastUpdate && <span>Oppdatert {lastUpdate.toLocaleTimeString("nb-NO")}</span>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
