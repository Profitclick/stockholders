import { useCallback, useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Row = { symbol: string; name: string; flags: number; last: string | null; turnover: number | null; short_pct: number | null };
const nf = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });

/** Most-flagged stocks: flag count, then daily turnover, then short pressure. */
export function rankFlagged(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => b.flags - a.flags || (b.turnover ?? 0) - (a.turnover ?? 0) || (b.short_pct ?? 0) - (a.short_pct ?? 0));
}

export function NewsWebFlagTargets() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [f, mq, sp] = await Promise.all([
      supabase.from("newsweb_flags").select("issuer_sign,issuer_name,published_time").order("published_time", { ascending: false }).limit(5000),
      supabase.from("market_quotes").select("symbol,isin,turnover").limit(5000),
      supabase.from("short_positions").select("isin,short_pct").limit(5000),
    ]);
    const err = f.error ?? mq.error ?? sp.error;
    if (err) toast.error(err.message);
    const quote = new Map((mq.data ?? []).map((q) => [q.symbol, q]));
    const short = new Map((sp.data ?? []).map((s) => [s.isin, Number(s.short_pct)]));
    const agg = new Map<string, Row>();
    for (const m of f.data ?? []) {
      const sym = m.issuer_sign ?? "";
      if (!sym) continue;
      const r = agg.get(sym);
      if (r) { r.flags++; continue; }
      const q = quote.get(sym);
      agg.set(sym, { symbol: sym, name: m.issuer_name ?? sym, flags: 1, last: m.published_time,
        turnover: q?.turnover == null ? null : Number(q.turnover), short_pct: q ? short.get(q.isin) ?? null : null });
    }
    setRows(rankFlagged([...agg.values()]));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("newsweb-flag-sync");
    setSyncing(false);
    if (error) {
      toast.error(`NewsWeb feilet: ${error instanceof FunctionsHttpError ? await error.context.text() : error.message}`);
      return;
    }
    toast.success(`${data.messages} flaggemeldinger for ${data.issuers} selskaper (siden ${data.from})`);
    load();
  };

  const top = useMemo(() => rows.slice(0, 100), [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-sm">Mest flaggede aksjer – NewsWeb (siste 90 dager)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Sortert etter antall flaggemeldinger, deretter dagsomsetning og short-press. Flagging gjelder store eiere, ikke småsparere.</p>
        </div>
        <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}Hent flaggemeldinger
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : !rows.length ? (
          <p className="text-sm text-muted-foreground">Ingen flaggemeldinger hentet ennå. Trykk «Hent flaggemeldinger».</p>
        ) : (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Selskap</TableHead><TableHead className="text-right">Flagg</TableHead>
                <TableHead className="text-right">Dagsomsetning</TableHead><TableHead className="text-right">Short %</TableHead>
                <TableHead className="text-right">Siste flagg</TableHead>
              </TableRow></TableHeader>
              <TableBody>{top.map((r) => (
                <TableRow key={r.symbol}>
                  <TableCell className="font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.symbol}</div></TableCell>
                  <TableCell className="text-right font-semibold">{r.flags}</TableCell>
                  <TableCell className="text-right">{r.turnover == null ? "–" : `${nf.format(r.turnover / 1e6)} M`}</TableCell>
                  <TableCell className="text-right">{r.short_pct == null ? "–" : nf.format(r.short_pct)}</TableCell>
                  <TableCell className="text-right">{r.last?.slice(0, 10) ?? "–"}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
