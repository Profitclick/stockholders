import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CsvDropzone } from "./CsvDropzone";
import { ColumnMapper, autoMap } from "./ColumnMapper";
import { ImportProgress } from "./ImportProgress";
import { toast } from "sonner";

const BATCH_SIZE = 10000;

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

type Step = "upload" | "mapping" | "importing" | "done";

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  
  const headers = lines[0].split(";").length > 1 
    ? lines[0].split(";").map(h => h.trim().replace(/^"|"$/g, ""))
    : lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  
  const delimiter = lines[0].split(";").length > 1 ? ";" : ",";
  
  const rows = lines.slice(1).map((line) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""))
  );
  return { headers, rows };
}

export function CsvImportDialog({ open, onOpenChange, onComplete }: CsvImportDialogProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [datasetType, setDatasetType] = useState("shareholder");
  const [progress, setProgress] = useState<{ progress: number; currentBatch: number; totalBatches: number; errors: number; warnings: number; status: "queued" | "running" | "completed" | "failed" }>({ progress: 0, currentBatch: 0, totalBatches: 0, errors: 0, warnings: 0, status: "queued" });

  const reset = () => {
    setStep("upload");
    setFile(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setPreviewRows([]);
    setMapping({});
    setProgress({ progress: 0, currentBatch: 0, totalBatches: 0, errors: 0, warnings: 0, status: "queued" });
  };

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    const text = await f.text();
    const { headers, rows } = parseCsv(text);
    setCsvHeaders(headers);
    setCsvRows(rows);
    setPreviewRows(rows.slice(0, 3));
    setMapping(autoMap(headers));
    setStep("mapping");
  }, []);

  const startImport = async () => {
    if (!csvRows.length) return;
    setStep("importing");

    const totalBatches = Math.ceil(csvRows.length / BATCH_SIZE);
    
    // Create job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({ type: "csv_import", status: "running" as const, total_batches: totalBatches })
      .select("id")
      .single();

    if (jobError || !job) {
      toast.error("Failed to create import job");
      setStep("mapping");
      return;
    }

    setProgress((p) => ({ ...p, totalBatches, status: "running" }));

    let totalErrors = 0;
    let totalWarnings = 0;

    for (let i = 0; i < totalBatches; i++) {
      const batchRows = csvRows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      
      // Convert rows to objects using headers
      const rowObjects = batchRows.map((row) => {
        const obj: Record<string, string> = {};
        csvHeaders.forEach((h, idx) => { obj[h] = row[idx] ?? ""; });
        return obj;
      });

      const { data, error } = await supabase.functions.invoke("csv-import", {
        body: {
          rows: rowObjects,
          column_mapping: mapping,
          dataset_type: datasetType,
          job_id: job.id,
          batch_index: i,
          total_batches: totalBatches,
        },
      });

      if (error) {
        totalErrors += batchRows.length;
        toast.error(`Batch ${i + 1} failed: ${error.message}`);
      } else if (data) {
        totalErrors += data.errors || 0;
        totalWarnings += data.warnings || 0;
      }

      setProgress({
        progress: ((i + 1) / totalBatches) * 100,
        currentBatch: i + 1,
        totalBatches,
        errors: totalErrors,
        warnings: totalWarnings,
        status: i + 1 >= totalBatches ? "completed" : "running",
      });
    }

    setStep("done");
    toast.success(`Import complete! ${csvRows.length.toLocaleString()} rows processed.`);
    onComplete?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Import CSV Data</DialogTitle>
        </DialogHeader>

        {step === "upload" && <CsvDropzone onFileSelected={handleFile} />}

        {step === "mapping" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{file?.name}</span> — {csvRows.length.toLocaleString()} rows, {csvHeaders.length} columns
              </div>
              <Select value={datasetType} onValueChange={setDatasetType}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Dataset type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shareholder">Shareholder</SelectItem>
                  <SelectItem value="price">Price</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="crm">CRM</SelectItem>
                  <SelectItem value="sector">Sector</SelectItem>
                  <SelectItem value="demographic">Demographic</SelectItem>
                  <SelectItem value="plugin">Plugin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <ColumnMapper
              csvHeaders={csvHeaders}
              previewRows={previewRows}
              mapping={mapping}
              onMappingChange={setMapping}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={startImport}>
                Start Import ({csvRows.length.toLocaleString()} rows)
              </Button>
            </div>
          </div>
        )}

        {(step === "importing" || step === "done") && (
          <div className="space-y-4">
            <ImportProgress {...progress} />
            {step === "done" && (
              <div className="flex justify-end">
                <Button onClick={() => { reset(); onOpenChange(false); }}>Close</Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
