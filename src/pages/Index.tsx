import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { Upload, PieChart, Users, Building2, Archive, BarChart3, Loader2, FileSpreadsheet, Database, Play, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CsvImportDialog } from "@/components/csv-import/CsvImportDialog";
import { ParquetImportDialog } from "@/components/parquet-import/ParquetImportDialog";
import { toast } from "sonner";
import { SourceHealth } from "@/components/SourceHealth";

interface Stats {
  investors: number;
  companies: number;
  imports: number;
  exports: number;
  businessRaw: number;
  parquetImports: number;
}

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number;
  current_batch: number;
  total_batches: number;
  errors_count: number;
  warnings_count: number;
  estimated_time_remaining: number | null;
  created_at: string;
  updated_at: string;
  metadata: any;
}

const STALE_JOB_THRESHOLD_MS = 45 * 60 * 1000;

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ investors: 0, companies: 0, imports: 0, exports: 0, businessRaw: 0, parquetImports: 0 });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [parquetOpen, setParquetOpen] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStep, setPipelineStep] = useState("");
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [dbAvailable, setDbAvailable] = useState(true);
  const pollIntervalRef = useRef(30000); // Start at 30s
  const navigate = useNavigate();

  useEffect(() => { loadStats(); loadJobs(); }, []);

  // Poll jobs with exponential backoff on errors
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const { data, error } = await supabase
          .from("jobs")
          .select("*")
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) {
          // DB busy — back off
          pollIntervalRef.current = Math.min(pollIntervalRef.current * 1.5, 120000);
          setDbAvailable(false);
          timeoutId = setTimeout(poll, pollIntervalRef.current);
          return;
        }

        setDbAvailable(true);
        pollIntervalRef.current = 30000; // Reset on success
        const activeJobs = (data as Job[]) ?? [];

        // Mark stale jobs (> 30 min)
        const staleThreshold = Date.now() - STALE_JOB_THRESHOLD_MS;
        const staleJobs = activeJobs.filter((job) => new Date(job.updated_at).getTime() < staleThreshold);
        if (staleJobs.length > 0) {
          await Promise.all(staleJobs.map((job) =>
            supabase.from("jobs").update({
              status: "failed" as const,
              metadata: {
                ...(job.metadata ?? {}),
                error: "Stale — no progress for 45+ min",
              },
            }).eq("id", job.id)
          ));
        }

        setJobs(activeJobs.filter(j => !staleJobs.some(s => s.id === j.id)));

        // Only fetch recent jobs if we have capacity
        const { data: recent } = await supabase
          .from("jobs")
          .select("*")
          .in("status", ["failed", "completed"])
          .order("created_at", { ascending: false })
          .limit(10);
        setRecentJobs((recent as Job[]) ?? []);
      } catch {
        pollIntervalRef.current = Math.min(pollIntervalRef.current * 2, 120000);
        setDbAvailable(false);
      }

      timeoutId = setTimeout(poll, pollIntervalRef.current);
    }

    // First poll after 5s delay to let initial load finish
    timeoutId = setTimeout(poll, 5000);
    return () => clearTimeout(timeoutId);
  }, []);

  async function loadStats() {
    try {
      // Try cached stats first (lightweight)
      const { data: cachedStats } = await supabase
        .from("pipeline_stats")
        .select("key, value");

      if (cachedStats && cachedStats.length > 0) {
        const statsMap = Object.fromEntries(cachedStats.map((s: any) => [s.key, Number(s.value)]));
        setStats({
          investors: statsMap.investors ?? 0,
          companies: statsMap.companies ?? 0,
          imports: statsMap.shareholder_raw ?? 0,
          exports: 0,
          businessRaw: 0,
          parquetImports: 0,
        });
        setLoading(false);

        // Refresh cache in background
        supabase.rpc("refresh_pipeline_stats").then(() => {}, () => {});
        return;
      }

      // Fallback: direct counts
      const [inv, comp, imp, exp, biz, pq] = await Promise.all([
        supabase.from("investors").select("id", { count: "exact", head: true }),
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("shareholder_raw").select("id", { count: "exact", head: true }),
        supabase.from("exports_archive").select("id", { count: "exact", head: true }),
        supabase.from("business_raw" as any).select("id", { count: "exact", head: true }),
        supabase.from("parquet_imports" as any).select("id", { count: "exact", head: true }),
      ]);
      setStats({
        investors: inv.count ?? 0,
        companies: comp.count ?? 0,
        imports: imp.count ?? 0,
        exports: exp.count ?? 0,
        businessRaw: (biz as any).count ?? 0,
        parquetImports: (pq as any).count ?? 0,
      });

      // Seed cache for next time
      supabase.rpc("refresh_pipeline_stats").then(() => {}, () => {});
    } catch {
      // DB unavailable
    } finally {
      setLoading(false);
    }
  }

  async function loadJobs() {
    try {
      const [jobsRes, recentRes] = await Promise.all([
        supabase.from("jobs").select("*").in("status", ["queued", "running"]).order("created_at", { ascending: false }).limit(10),
        supabase.from("jobs").select("*").in("status", ["failed", "completed"]).order("created_at", { ascending: false }).limit(10),
      ]);
      setJobs((jobsRes.data as Job[]) ?? []);
      setRecentJobs((recentRes.data as Job[]) ?? []);
    } catch {
      // DB unavailable
    }
  }

  async function runDataCleanup() {
    setCleanupRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-cleanup", {
        body: { startAggregationAfter: false },
      });
      if (error) throw error;
      toast.success(data?.status === "already_running"
        ? "Cleanup is already running."
        : "Cleanup started in background. Check jobs for progress.");
      setTimeout(() => {
        loadJobs();
        loadStats();
      }, 3000);
    } catch (err: any) {
      toast.error(`Cleanup failed: ${err.message}`);
    } finally {
      setCleanupRunning(false);
    }
  }

  async function runFullPipeline() {
    setPipelineRunning(true);
    try {
      setPipelineStep("Starting cleanup...");
      const { data, error } = await supabase.functions.invoke("data-cleanup", {
        body: { startAggregationAfter: true },
      });
      if (error) throw new Error(`Pipeline: ${error.message}`);

      toast.success(data?.status === "already_running"
        ? "Cleanup is already running. Aggregation will start automatically when it finishes."
        : "Cleanup started. Aggregation will start automatically after cleanup finishes.");
      setPipelineStep("Cleanup running...");
      setTimeout(() => {
        loadJobs();
        loadStats();
      }, 3000);
    } catch (err: any) {
      toast.error(`Pipeline failed: ${err.message}`);
    } finally {
      setPipelineRunning(false);
      setPipelineStep("");
    }
  }

  async function runEnrichAndScore() {
    setPipelineRunning(true);
    try {
      setPipelineStep("Enriching companies via Brreg...");
      const { error: enrichErr } = await supabase.functions.invoke("mcp-enrich", { body: {} });
      if (enrichErr) throw new Error(`Enrichment: ${enrichErr.message}`);

      setPipelineStep("Scoring investors...");
      const { data: scoreData, error: scoreErr } = await supabase.functions.invoke("ias-scoring", { body: {} });
      if (scoreErr) throw new Error(`Scoring: ${scoreErr.message}`);

      toast.success(`Enrichment & scoring complete! ${scoreData?.scored ?? 0} investors scored.`);
      loadStats();
    } catch (err: any) {
      toast.error(`Enrich & Score failed: ${err.message}`);
    } finally {
      setPipelineRunning(false);
      setPipelineStep("");
    }
  }

  async function retryJob(jobId: string) {
    await supabase.from("jobs").delete().eq("id", jobId);
    toast.info("Job dismissed. Use pipeline buttons to restart.");
    loadJobs();
  }

  async function dismissJob(jobId: string) {
    await supabase.from("jobs").delete().eq("id", jobId);
    setRecentJobs(prev => prev.filter(j => j.id !== jobId));
    toast.success("Job dismissed.");
  }

  const statCards = [
    { label: "Investors", value: stats.investors, icon: Users, path: "/investors" },
    { label: "Companies", value: stats.companies, icon: Building2, path: "/companies" },
    { label: "Raw Records", value: stats.imports, icon: Upload, path: "/" },
    { label: "Business Raw", value: stats.businessRaw, icon: Database, path: "/" },
    { label: "Exports", value: stats.exports, icon: Archive, path: "/exports" },
    { label: "Parquet Files", value: stats.parquetImports, icon: FileSpreadsheet, path: "/" },
  ];

  const hasActiveJob = jobs.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          {!dbAvailable && (
            <p className="text-xs text-destructive mt-1">⚠ Database busy — polling reduced. Data may be stale.</p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setImportOpen(true)} variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={() => setParquetOpen(true)} variant="outline" size="sm">
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Import Parquet
          </Button>
          <Button onClick={runDataCleanup} disabled={cleanupRunning || hasActiveJob} variant="outline" size="sm">
            {cleanupRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
            Data Cleanup
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pipeline Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap items-center">
            <Button onClick={runFullPipeline} disabled={pipelineRunning || hasActiveJob} size="sm">
              {pipelineRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Run Full Pipeline
            </Button>
            <Button onClick={runEnrichAndScore} disabled={pipelineRunning || hasActiveJob} variant="outline" size="sm">
              {pipelineRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
              Enrich & Score
            </Button>
            <Button onClick={() => navigate("/segments")} variant="outline" size="sm">
              <PieChart className="mr-2 h-4 w-4" /> Segments
            </Button>
            {pipelineStep && <span className="text-sm text-muted-foreground">{pipelineStep}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Full Pipeline: Cleanup runs first, then aggregation starts automatically; run Enrich & Score after aggregation completes.
          </p>
        </CardContent>
      </Card>

      <SourceHealth />



      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((s) => (
          <Card key={s.label} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(s.path)}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold">{loading ? "…" : s.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active jobs</p>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div key={job.id} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{job.type}</span>
                    <span className="text-muted-foreground">
                      {job.metadata?.phase && <span className="mr-2">Phase: {job.metadata.phase}</span>}
                      Batch {job.current_batch}/{job.total_batches}
                    </span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{Math.round(job.progress)}%</span>
                    {job.metadata?.investors_processed > 0 && <span>{job.metadata.investors_processed.toLocaleString()} investors</span>}
                    {job.metadata?.companies_processed > 0 && <span>{job.metadata.companies_processed.toLocaleString()} companies</span>}
                    {job.errors_count > 0 && <span className="text-destructive">{job.errors_count} errors</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between border rounded-md p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{job.type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${job.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                        {job.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.created_at).toLocaleString()}
                      {job.metadata?.error && <span className="ml-2 text-destructive">— {job.metadata.error}</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => dismissJob(job.id)}>
                    Dismiss
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} onComplete={() => { loadStats(); loadJobs(); }} />
      <ParquetImportDialog open={parquetOpen} onOpenChange={setParquetOpen} onComplete={() => { loadStats(); loadJobs(); }} />
    </div>
  );
}
