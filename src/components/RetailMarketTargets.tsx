import { useCallback, useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import { CRYPTO_RE, brokerScore, cryptoScore, gearingScore } from "@/lib/retailPropensity";

type Row = {
  orgnr: string; name: string; symbol: string; market: string | null; currency: string | null;
  last_price: number | null; turnover: number | null; total_shareholders: number | null;
  retail_pct: number | null; direct_person_shift_pp: number | null; retail_shift_pp: number | null; quote_date: string | null;
  short_pct: number | null; gearing: number; broker: number; crypto: number;
};

type SegmentId = "all" | "penny" | "crypto" | "ai" | "broker" | "short" | "hot";
const CRYPTO = CRYPTO_RE;
const AI = /(\bai\b|artificial|data|tech|software|fintech|robot|quantum|cyber|cloud|analytics|digital)/i;

export const SEGMENTS: { id: SegmentId; label: string; hint: string; test: (r: Row) => boolean }[] = [
  { id: "all", label: "Alle", hint: "Alle noterte retail-kandidater", test: () => true },
  { id: "hot", label: "Gearing-score ≥ 70", hint: "Lav kurs, høy omsetning og short-press", test: (r) => r.gearing >= 70 },
  { id: "penny", label: "Penny & gearing", hint: "Kurs under 2 og omsetning over 0,2 M", test: (r) => (r.last_price ?? 99) < 2 && (r.turnover ?? 0) > 200_000 },
  { id: "short", label: "Short-press", hint: "Netto short ≥ 1 % i Finanstilsynets register", test: (r) => (r.short_pct ?? 0) >= 1 },
  { id: "crypto", label: "Krypto & Web3", hint: "Blokkjede/krypto i selskapsnavnet", test: (r) => CRYPTO.test(r.name) },
  { id: "ai", label: "AI & tech", hint: "Teknologi/AI/fintech i selskapsnavnet", test: (r) => AI.test(r.name) },
  { id: "broker", label: "Bred nettmegler-base", hint: "Nettmeglerandel minst 15 %", test: (r) => (r.retail_pct ?? 0) >= 15 },
];

/** Indicative audience tags — heuristics on company traits, never facts about individual investors. */
export function audienceTags(r: Row): string[] {
  const tags: string[] = [];
  if ((r.retail_pct ?? 0) >= 10) tags.push("Nordnet/nettmegler");
  if ((r.last_price ?? 99) < 5 && (r.turnover ?? 0) > 200_000) tags.push("CFD/gearing");
  if ((r.short_pct ?? 0) >= 1) tags.push("Short-press");
  if (CRYPTO.test(r.name)) tags.push("Krypto");
  return tags;
}

const nf = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 });
const mnok = (v: number | null) => (v == null ? "–" : `${nf.format(v / 1e6)} M`);
const pp = (v: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${nf.format(v)}`);
type SortKey = "turnover" | "last_price" | "total_shareholders" | "retail_pct" | "direct_person_shift_pp" | "short_pct" | "gearing" | "broker";

export function RetailMarketTargets() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [segment, setSegment] = useState<SegmentId>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "gearing", desc: true });

  const load = useCallback(async () => {
    setLoading(true);
    const [t, mq, sp] = await Promise.all([
      supabase.from("retail_market_targets")
        .select("orgnr,name,symbol,market,currency,last_price,turnover,total_shareholders,retail_pct,direct_person_shift_pp,retail_shift_pp,quote_date")
        .order("turnover", { ascending: false, nullsFirst: false }).limit(1000),
      supabase.from("market_quotes").select("orgnr,isin").limit(5000),
      supabase.from("short_positions").select("isin,short_pct").limit(5000),
    ]);
    const err = t.error ?? mq.error ?? sp.error;
    if (err) toast.error(err.message);
    const isinOf = new Map((mq.data ?? []).map((m) => [m.orgnr, m.isin]));
    const shortOf = new Map((sp.data ?? []).map((s) => [s.isin, Number(s.short_pct)]));
    setRows(((t.data ?? []) as Omit<Row, "short_pct" | "gearing" | "broker" | "crypto">[]).map((r) => {
      const short_pct = shortOf.get(isinOf.get(r.orgnr) ?? "") ?? null;
      const x = { ...r, short_pct };
      return { ...x, gearing: gearingScore(x), broker: brokerScore(x), crypto: cryptoScore(x) };
    }));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const syncShort = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("short-register-sync");
    setSyncing(false);
    if (error) {
      const details = error instanceof FunctionsHttpError ? await error.context.text() : error.message;
      toast.error(`Shortregister feilet: ${details}`);
      return;
    }
    toast.success(`${data.active} aksjer med aktiv short hentet fra Finanstilsynet`);
    load();
  };

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

  const counts = useMemo(() => Object.fromEntries(SEGMENTS.map((s) => [s.id, rows.filter(s.test).length])), [rows]);
  const visible = useMemo(() => {
    const seg = SEGMENTS.find((s) => s.id === segment)!;
    const needle = q.trim().toLowerCase();
    return rows
      .filter(seg.test)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.symbol.toLowerCase().includes(needle))
      .sort((a, b) => {
        const av = a[sort.key] ?? -Infinity, bv = b[sort.key] ?? -Infinity;
        return sort.desc ? (bv as number) - (av as number) : (av as number) - (bv as number);
      });
  }, [rows, segment, q, sort]);

  const kpi = useMemo(() => {
    const prices = visible.map((r) => r.last_price).filter((v): v is number => v != null).sort((a, b) => a - b);
    const retail = visible.map((r) => r.retail_pct).filter((v): v is number => v != null);
    return {
      median: prices.length ? prices[Math.floor(prices.length / 2)] : null,
      turnover: visible.reduce((s, r) => s + (r.turnover ?? 0), 0),
      retail: retail.length ? retail.reduce((s, v) => s + v, 0) / retail.length : null,
    };
  }, [visible]);

  const exportCsv = () => {
    const csv = Papa.unparse(visible.map((r) => ({
      orgnr: r.orgnr, selskap: r.name, ticker: r.symbol, marked: r.market, kurs: r.last_price, valuta: r.currency,
      dagsomsetning: r.turnover, eiere: r.total_shareholders, nettmegler_pct: r.retail_pct,
      nettmegler_endring_pp: r.retail_shift_pp, personandel_endring_pp: r.direct_person_shift_pp,
      short_pct: r.short_pct, gearing_score: r.gearing, nettmegler_score: r.broker, krypto_score: r.crypto,
      malgruppe_indikasjon: audienceTags(r).join(" | "), kursdato: r.quote_date,
    })), { delimiter: ";" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `retail-${segment}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <TableHead className="text-right">
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : true }))}>
        {children}<ArrowUpDown className={`h-3 w-3 ${sort.key === k ? "text-foreground" : "opacity-40"}`} />
      </button>
    </TableHead>
  );

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm">Retail-segmenter – Oslo Børs / Euronext</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Velg segment, søk og eksporter. Målgruppe-tagger er indikasjoner på selskapsnivå, ikke fakta om enkeltpersoner.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={syncShort} disabled={syncing}>Hent shortregister</Button>
            <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
              {syncing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}Hent kurser
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={!visible.length}><Download className="mr-2 h-3 w-3" />CSV ({visible.length})</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map((s) => (
            <Button key={s.id} size="sm" variant={segment === s.id ? "default" : "outline"} title={s.hint} onClick={() => setSegment(s.id)}>
              {s.label}<Badge variant="secondary" className="ml-2">{counts[s.id] ?? 0}</Badge>
            </Button>
          ))}
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          {[["Selskaper", String(visible.length)], ["Mediankurs", kpi.median == null ? "–" : nf.format(kpi.median)],
            ["Samlet omsetning", mnok(kpi.turnover)], ["Snitt nettmegler", kpi.retail == null ? "–" : `${nf.format(kpi.retail)} %`]].map(([l, v]) => (
            <div key={l} className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{l}</div><div className="text-sm font-semibold">{v}</div></div>
          ))}
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Søk selskap eller ticker" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen kurser hentet ennå. Trykk «Hent kurser».</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen treff i dette segmentet.</p>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <p className="text-xs text-muted-foreground mb-2">Kursdato {rows[0].quote_date ?? "–"}</p>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Selskap</TableHead><TableHead>Målgruppe</TableHead>
                <SortHead k="last_price">Kurs</SortHead><SortHead k="turnover">Omsetning</SortHead>
                <SortHead k="total_shareholders">Eiere</SortHead><SortHead k="direct_person_shift_pp">Person Δ pp</SortHead>
                <SortHead k="retail_pct">Nettmegler %</SortHead><SortHead k="short_pct">Short %</SortHead>
                <SortHead k="gearing">Gearing</SortHead><SortHead k="broker">Nettmegler-score</SortHead>
              </TableRow></TableHeader>
              <TableBody>{visible.map((r) => (
                <TableRow key={r.orgnr}>
                  <TableCell className="font-medium">{r.name}<div className="text-xs text-muted-foreground">{r.symbol} · {r.orgnr}</div></TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{audienceTags(r).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}</div></TableCell>
                  <TableCell className="text-right">{r.last_price == null ? "–" : `${nf.format(r.last_price)} ${r.currency ?? ""}`}</TableCell>
                  <TableCell className="text-right">{mnok(r.turnover)}</TableCell>
                  <TableCell className="text-right">{r.total_shareholders ?? "–"}</TableCell>
                  <TableCell className="text-right">{pp(r.direct_person_shift_pp)}</TableCell>
                  <TableCell className="text-right">{r.retail_pct == null ? "–" : `${nf.format(r.retail_pct)} (${pp(r.retail_shift_pp)})`}</TableCell>
                  <TableCell className="text-right">{r.short_pct == null ? "–" : nf.format(r.short_pct)}</TableCell>
                  <TableCell className="text-right font-semibold">{r.gearing}</TableCell>
                  <TableCell className="text-right">{r.broker}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
