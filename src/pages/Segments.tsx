import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Download, Loader2, UserCheck, Users } from "lucide-react";
import { PlaybookStudio } from "@/components/PlaybookStudio";
import { toast } from "sonner";
import { format } from "date-fns";
import * as XLSX from "xlsx";
import Papa from "papaparse";

interface Segment {
  id: string;
  profile_id: string | null;
  investor_ids: any;
  summary: any;
  created_at: string;
}

export default function Segments() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Segment | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [lookalikeOpen, setLookalikeOpen] = useState(false);
  const [lookalikeFile, setLookalikeFile] = useState<File | null>(null);
  const [lookalikeLimit, setLookalikeLimit] = useState("500");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    supabase.from("segments").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      setSegments((data as Segment[]) ?? []);
      setLoading(false);
    });
  }, []);

  async function exportSegment(segmentId: string, fmt: string, leadOptimized = false) {
    setExporting(segmentId);
    try {
      const { data, error } = await supabase.functions.invoke("export-segment", {
        body: { segment_id: segmentId, format: fmt, lead_optimized: leadOptimized },
      });
      if (error) throw error;
      const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], {
        type: fmt === "json" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `segment_${segmentId.slice(0, 8)}${leadOptimized ? "_leads" : ""}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err: any) {
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setExporting(null);
    }
  }

  async function generateLookalike() {
    if (!lookalikeFile) { toast.error("Upload a customer file"); return; }
    setGenerating(true);

    try {
      const ext = lookalikeFile.name.split(".").pop()?.toLowerCase();
      let rows: Record<string, unknown>[];

      if (ext === "xlsx" || ext === "xls") {
        const buf = await lookalikeFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      } else if (ext === "json") {
        const parsed = JSON.parse(await lookalikeFile.text());
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        const parsed = Papa.parse(await lookalikeFile.text(), { header: true, skipEmptyLines: true });
        rows = parsed.data as Record<string, unknown>[];
      }

      if (!rows || rows.length === 0) {
        toast.error("Filen inneholder ingen rader");
        setGenerating(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("generate-lookalike", {
        body: { seed_companies: rows, limit: parseInt(lookalikeLimit) || 500 },
      });
      if (error) throw error;

      toast.success(`Lookalike segment created with ${data.matched} investors`);
      setLookalikeOpen(false);
      setLookalikeFile(null);

      // Reload segments
      const { data: segs } = await supabase.from("segments").select("*").order("created_at", { ascending: false });
      setSegments((segs as Segment[]) ?? []);
    } catch (err: any) {
      toast.error(`Lookalike failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  const summary = selected?.summary as any;
  const isLookalike = (s: Segment) => (s.summary as any)?.type === "lookalike";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground">Segments</h1>
        <Button size="sm" onClick={() => setLookalikeOpen(true)}>
          <Users className="mr-2 h-4 w-4" /> Create Lookalike
        </Button>
      </div>

      <PlaybookStudio />

      <h2 className="text-lg font-semibold text-foreground pt-2">Lagrede segmenter</h2>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Investors</TableHead>
                <TableHead>Avg Score</TableHead>
                <TableHead>Created</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : segments.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No segments generated yet.</TableCell></TableRow>
              ) : segments.map((s) => {
                const sum = s.summary as any;
                const lookalike = isLookalike(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-sm">{sum?.profile_name ?? "—"}</TableCell>
                    <TableCell>
                      {lookalike ? (
                        <Badge variant="default" className="bg-primary">Lookalike</Badge>
                      ) : (
                        <Badge variant="secondary">Profile</Badge>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{sum?.total_investors ?? 0}</Badge></TableCell>
                    <TableCell className="font-mono text-sm">{sum?.avg_score ?? sum?.avg_similarity ?? "—"}</TableCell>
                    <TableCell className="text-sm">{format(new Date(s.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setSelected(s)}>View</Button>
                        <Button variant="outline" size="sm" onClick={() => exportSegment(s.id, "csv")} disabled={exporting === s.id}>
                          {exporting === s.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                          CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => exportSegment(s.id, "csv", true)} disabled={exporting === s.id}>
                          <UserCheck className="mr-1 h-3 w-3" /> Leads
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => exportSegment(s.id, "json")} disabled={exporting === s.id}>
                          JSON
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Segment Details Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader><DialogTitle>Segment Details — {summary?.profile_name}</DialogTitle></DialogHeader>
          {selected && summary && (
            <div className="space-y-4">
              {summary.type === "lookalike" && summary.seed_profile && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-3">
                    <p className="text-sm font-medium text-primary">Lookalike Segment</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Seed: {summary.seed_profile.seed_size} companies · Avg similarity: {summary.avg_similarity}
                    </p>
                    {summary.seed_profile.industries?.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {summary.seed_profile.industries.slice(0, 5).map((ind: string) => (
                          <Badge key={ind} variant="outline" className="text-xs">{ind}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total", value: summary.total_investors },
                  { label: summary.type === "lookalike" ? "Avg Similarity" : "Avg Score", value: summary.avg_score ?? summary.avg_similarity },
                  { label: "Min Score", value: summary.min_score },
                  { label: "Max Score", value: summary.max_score },
                ].filter(s => s.value != null).map((s) => (
                  <Card key={s.label}>
                    <CardContent className="p-3 text-center">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-xl font-bold">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {summary.score_histogram && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Score Distribution</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-1 h-32">
                      {(summary.score_histogram as any[]).map((bucket: any) => {
                        const maxCount = Math.max(...(summary.score_histogram as any[]).map((b: any) => b.count), 1);
                        const height = (bucket.count / maxCount) * 100;
                        return (
                          <div key={bucket.range} className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full bg-primary/80 rounded-t" style={{ height: `${height}%`, minHeight: bucket.count > 0 ? 4 : 0 }} />
                            <span className="text-[10px] text-muted-foreground">{bucket.range}</span>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {summary.type_distribution && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Entity Types</CardTitle></CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(summary.type_distribution).map(([type, count]) => (
                        <Badge key={type} variant="secondary">{type}: {count as number}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {summary.top_municipalities && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Top Municipalities</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {Object.entries(summary.top_municipalities).map(([muni, count]) => (
                        <div key={muni} className="flex justify-between text-sm">
                          <span>{muni}</span>
                          <span className="font-mono text-muted-foreground">{count as number}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Lookalike Dialog */}
      <Dialog open={lookalikeOpen} onOpenChange={setLookalikeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create Lookalike Segment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload your customer list (CSV, Excel, or JSON). We'll analyze it and find similar investors in the database.
            </p>
            <div className="space-y-2">
              <Label>Customer File</Label>
              <Input type="file" accept=".csv,.xlsx,.xls,.json" onChange={(e) => setLookalikeFile(e.target.files?.[0] ?? null)} />
              {lookalikeFile && <p className="text-xs text-muted-foreground">{lookalikeFile.name}</p>}
            </div>
            <div className="space-y-2">
              <Label>Max results</Label>
              <Input type="number" value={lookalikeLimit} onChange={(e) => setLookalikeLimit(e.target.value)} min="50" max="5000" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLookalikeOpen(false)}>Cancel</Button>
            <Button onClick={generateLookalike} disabled={generating || !lookalikeFile}>
              {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</> : <><Users className="mr-2 h-4 w-4" /> Generate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
