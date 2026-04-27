import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface ImportProgressProps {
  progress: number;
  currentBatch: number;
  totalBatches: number;
  errors: number;
  warnings: number;
  status: "queued" | "running" | "completed" | "failed";
}

export function ImportProgress({ progress, currentBatch, totalBatches, errors, warnings, status }: ImportProgressProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {status === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {status === "completed" && <CheckCircle2 className="h-4 w-4 text-primary" />}
          {status === "failed" && <AlertCircle className="h-4 w-4 text-destructive" />}
          <span className="font-medium text-foreground">
            {status === "completed" ? "Import Complete" : status === "failed" ? "Import Failed" : "Importing..."}
          </span>
        </div>
        <span className="text-muted-foreground">
          Batch {currentBatch}/{totalBatches}
        </span>
      </div>
      <Progress value={progress} className="h-2" />
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>{Math.round(progress)}%</span>
        {errors > 0 && <Badge variant="destructive" className="text-xs">{errors} errors</Badge>}
        {warnings > 0 && <Badge variant="secondary" className="text-xs">{warnings} warnings</Badge>}
      </div>
    </div>
  );
}
