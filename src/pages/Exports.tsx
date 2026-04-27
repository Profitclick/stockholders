import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface Export {
  id: string;
  segment_id: string | null;
  profile_id: string | null;
  format: string;
  file_path: string | null;
  row_count: number;
  metadata: any;
  created_at: string;
}

export default function Exports() {
  const [exports, setExports] = useState<Export[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Export | null>(null);

  async function load() {
    const { data } = await supabase.from("exports_archive").select("*").order("created_at", { ascending: false });
    setExports((data as Export[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function reExport(exp: Export) {
    if (!exp.segment_id) return;
    try {
      const { data, error } = await supabase.functions.invoke("export-segment", {
        body: {
          segment_id: exp.segment_id,
          format: exp.format,
          lead_optimized: (exp.metadata as any)?.lead_optimized ?? false,
        },
      });
      if (error) throw error;
      const blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], {
        type: exp.format === "json" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `re_export_${exp.id.slice(0, 8)}.${exp.format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Exports Archive</h1>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-2 h-4 w-4" /> Refresh</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Type</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : exports.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No exports yet.</TableCell></TableRow>
              ) : exports.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm">{format(new Date(e.created_at), "yyyy-MM-dd HH:mm")}</TableCell>
                  <TableCell><Badge variant="secondary">{e.format.toUpperCase()}</Badge></TableCell>
                  <TableCell>{e.row_count.toLocaleString()}</TableCell>
                  <TableCell>
                    {(e.metadata as any)?.lead_optimized ? (
                      <Badge variant="default">Lead-Optimized</Badge>
                    ) : (
                      <Badge variant="outline">Standard</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(e)}>View</Button>
                      {e.segment_id && (
                        <Button variant="outline" size="sm" onClick={() => reExport(e)}>
                          <Download className="mr-1 h-3 w-3" /> Re-export
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Export Details</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div><span className="text-muted-foreground">Date:</span> {format(new Date(selected.created_at), "PPpp")}</div>
              <div><span className="text-muted-foreground">Format:</span> {selected.format}</div>
              <div><span className="text-muted-foreground">Rows:</span> {selected.row_count.toLocaleString()}</div>
              <div><span className="text-muted-foreground">Lead-Optimized:</span> {(selected.metadata as any)?.lead_optimized ? "Yes" : "No"}</div>
              <div>
                <p className="font-medium mb-1">Metadata</p>
                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">{JSON.stringify(selected.metadata, null, 2)}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
