import { useCallback, useEffect, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Row = {
  orgnr: string; name: string; symbol: string; market: string | null; currency: string | null;
  last_price: number | null; turnover: number | null; total_shareholders: number | null;
  retail_pct: number | null; direct_person_shift_pp: number | null; retail_shift_pp: number | null; quote_date: string | null;
};

const nf = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });
const mnok = (v: number | null) => (v == null ? "–" : `${nf.format(v / 1e6)} M`);
const pp = (v: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${nf.format(v)}`);

export function RetailMarketTargets() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("retail_market_targets")
      .select("orgnr,name,symbol,market,currency,last_price,turnover,total_shareholders,retail_pct,direct_person_shift_pp,retail_shift_pp,quote_date")
      .order("turnover", { ascending: false, nullsFirst: false }).limit(500);
    if (error) toast.error(error.message);
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("market-quotes-sync");
    setSyncing(false);
    if (error) {
      const details = error instanceof FunctionsHttpError ? await error.context.text() : error.message;
      toast.error(`Kurshenting feilet: ${details}`);
      return;
    }
    toast.success(`${data.matched} av ${data.listings} noterte selskaper koblet (${data.quote_date ?? "ukjent dato"})`);
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-sm">Noterte retail-selskaper – Oslo Børs / Euronext</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">Sluttkurs og omsetning siste handelsdag fra Euronext, koblet på selskapsnavn. Omsetning er likviditet, ikke kurtasje. Personandel er årsregisterendring, ikke dokumenterte kjøp.</p>
        </div>
        <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
          {syncing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}Hent kurser
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen kurser hentet ennå. Trykk «Hent kurser».</p>
        ) : (
          <div className="overflow-x-auto">
            <p className="text-xs text-muted-foreground mb-2">{rows.length} selskaper · kursdato {rows[0].quote_date ?? "–"}</p>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Selskap</TableHead><TableHead>Ticker</TableHead><TableHead className="text-right">Kurs</TableHead>
                <TableHead className="text-right">Omsetning</TableHead><TableHead className="text-right">Eiere</TableHead>
                <TableHead className="text-right">Personandel Δ pp</TableHead><TableHead className="text-right">Nettmegler %</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map((r) => (
                <TableRow key={r.orgnr}>
                  <TableCell className="font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.orgnr}</div></TableCell>
                  <TableCell><Badge variant="secondary">{r.symbol}</Badge><div className="text-xs text-muted-foreground">{r.market}</div></TableCell>
                  <TableCell className="text-right">{r.last_price == null ? "–" : `${nf.format(r.last_price)} ${r.currency ?? ""}`}</TableCell>
                  <TableCell className="text-right">{mnok(r.turnover)}</TableCell>
                  <TableCell className="text-right">{r.total_shareholders ?? "–"}</TableCell>
                  <TableCell className="text-right">{pp(r.direct_person_shift_pp)}</TableCell>
                  <TableCell className="text-right">{r.retail_pct == null ? "–" : `${nf.format(r.retail_pct)} (${pp(r.retail_shift_pp)})`}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
