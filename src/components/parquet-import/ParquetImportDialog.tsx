import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ParquetImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

type Step = "upload" | "config" | "importing" | "done";

const BATCH_SIZE = 10000;

export function ParquetImportDialog({ open, onOpenChange, onComplete }: ParquetImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [schema, setSchema] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [allRows, setAllRows] = useState<any[]>([]);
  const [targetTable, setTargetTable] = useState("shareholder_raw");
  const [asOfYear, setAsOfYear] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [batchInfo, setBatchInfo] = useState("");
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState({ inserted: 0, errors: 0 });
  const [parsing, setParsing] = useState(false);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.name.endsWith(".parquet")) {
      await parseFile(f);
    } else {
      toast.error("Please drop a .parquet file");
    }
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) await parseFile(f);
  }, []);

  async function parseFile(f: File) {
    setFile(f);
    setParsing(true);
    try {
      const parquetWasm = await import("parquet-wasm");
      await parquetWasm.default();

      const buffer = await f.arrayBuffer();
      const table = parquetWasm.readParquet(new Uint8Array(buffer));
      const arrowJson = table.intoIPCStream();

      // Use Apache Arrow to read the IPC stream
      const arrow = await import("apache-arrow");
      const arrowTable = arrow.tableFromIPC(arrowJson);

      const cols = arrowTable.schema.fields.map((field: any) => field.name);
      setSchema(cols);

      const rows: any[] = [];
      for (let i = 0; i < arrowTable.numRows; i++) {
        const row: any = {};
        for (const col of cols) {
          const val = arrowTable.getChild(col)?.get(i);
          row[col] = val instanceof Date ? val.toISOString() : val;
        }
        rows.push(row);
      }
      setAllRows(rows);
      setTotalRows(rows.length);
      setStep("config");
    } catch (err: any) {
      toast.error(`Failed to parse parquet: ${err.message}`);
    } finally {
      setParsing(false);
    }
  }

  async function startImport() {
    setImporting(true);
    setStep("importing");
    const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);
    let totalInserted = 0;
    let totalErrors = 0;

    // Create job
    const { data: jobData } = await supabase
      .from("jobs")
      .insert({ type: "parquet_import", status: "running", total_batches: totalBatches })
      .select("id")
      .single();
    const jobId = jobData?.id;

    // Create parquet_imports record
    const { data: pqImport } = await supabase
      .from("parquet_imports" as any)
      .insert({ filename: file?.name ?? "unknown.parquet", schema: schema, row_count: totalRows, status: "importing" } as any)
      .select("id")
      .single();
    const pqImportId = (pqImport as any)?.id;

    for (let b = 0; b < totalBatches; b++) {
      let batch = allRows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      // Inject as_of_year if user selected one
      if (asOfYear && targetTable === "shareholder_raw") {
        batch = batch.map(row => ({ ...row, as_of_year: Number(asOfYear) }));
      }
      setBatchInfo(`Batch ${b + 1}/${totalBatches}`);
      setProgress(((b + 1) / totalBatches) * 100);

      try {
        const { data, error } = await supabase.functions.invoke("parquet-import", {
          body: {
            rows: batch,
            job_id: jobId,
            target_table: targetTable,
            batch_index: b,
            total_batches: totalBatches,
            parquet_import_id: pqImportId,
          },
        });
        if (error) throw error;
        totalInserted += data?.inserted ?? 0;
        totalErrors += data?.errors ?? 0;
      } catch (err: any) {
        totalErrors += batch.length;
        toast.error(`Batch ${b + 1} failed: ${err.message}`);
      }
    }

    setResults({ inserted: totalInserted, errors: totalErrors });
    setStep("done");
    setImporting(false);
    toast.success(`Imported ${totalInserted.toLocaleString()} rows`);
    onComplete?.();
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setSchema([]);
    setTotalRows(0);
    setAllRows([]);
    setAsOfYear("");
    setProgress(0);
    setResults({ inserted: 0, errors: 0 });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!importing) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Parquet File</DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => document.getElementById("parquet-file-input")?.click()}
          >
            {parsing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Parsing parquet file...</p>
              </div>
            ) : (
              <>
                <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Drop a .parquet file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              </>
            )}
            <input id="parquet-file-input" type="file" accept=".parquet" className="hidden" onChange={handleFileSelect} />
          </div>
        )}

        {step === "config" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="secondary">{file?.name}</Badge>
              <Badge variant="outline">{totalRows.toLocaleString()} rows</Badge>
              <Badge variant="outline">{schema.length} columns</Badge>
            </div>

            <div>
              <Label>Detected Columns</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {schema.slice(0, 20).map((col) => (
                  <Badge key={col} variant="secondary" className="text-xs">{col}</Badge>
                ))}
                {schema.length > 20 && <Badge variant="outline">+{schema.length - 20} more</Badge>}
              </div>
            </div>

            <div>
              <Label>Target Table</Label>
              <Select value={targetTable} onValueChange={setTargetTable}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shareholder_raw">shareholder_raw (Aksjonærregisteret)</SelectItem>
                  <SelectItem value="business_raw">business_raw (Business Dataset)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {targetTable === "shareholder_raw" && (
              <div>
                <Label>Årstall (as_of_year)</Label>
                <Select value={asOfYear} onValueChange={setAsOfYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Velg årstall for datasettet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Autodetekt fra data</SelectItem>
                    <SelectItem value="2022">2022</SelectItem>
                    <SelectItem value="2023">2023</SelectItem>
                    <SelectItem value="2024">2024</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Sett årstall for YoY-analyse og trigger-deteksjon</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button onClick={startImport} className="flex-1">
                <Upload className="mr-2 h-4 w-4" />
                Import {totalRows.toLocaleString()} rows
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">Importing...</span>
              <span className="text-sm text-muted-foreground ml-auto">{batchInfo}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">{Math.round(progress)}%</p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <div>
              <p className="text-lg font-semibold">{results.inserted.toLocaleString()} rows imported</p>
              {results.errors > 0 && <p className="text-sm text-destructive">{results.errors} errors</p>}
            </div>
            <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
