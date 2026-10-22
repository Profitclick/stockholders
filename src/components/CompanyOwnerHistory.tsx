import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EVENT_LABELS, OWNERSHIP_YEARS, ownershipEvents, type OwnershipHistory } from "@/lib/ownershipHistory";

const PAGE_SIZE = 100;
type Summary = { owner_count: number; entry_count: number; exit_count: number; majority_count: number; increase_count: number; decrease_count: number };
const formatPct = (n: number | null) => n == null ? "—" : `${Number(n).toLocaleString("nb-NO", { maximumFractionDigits: 4 })} %`;

export function CompanyOwnerHistory({ orgnr }: { orgnr: string }) {
  const [rows, setRows] = useState<OwnershipHistory[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [event, setEvent] = useState("all");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<OwnershipHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    supabase.from("historical_ownership_signals").select("owner_count,entry_count,exit_count,majority_count,increase_count,decrease_count")
      .eq("orgnr", orgnr).maybeSingle().then(({ data, error: err }) => {
        if (!cancelled) { setSummary(data); if (err) setError(err.message); }
      });
    return () => { cancelled = true; };
  }, [orgnr]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setRows([]); setSelected(null); setError("");
    const timer = setTimeout(async () => {
      let query = supabase.from("company_person_history")
        .select("id,orgnr,shareholder_name,birth_year,pct_2022,pct_2023,pct_2024,pct_2025,shares_2022,shares_2023,shares_2024,shares_2025", { count: "exact" })
        .eq("orgnr", orgnr).order("id").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      const term = search.trim().replace(/[%_\\]/g, "");
      if (term) query = query.ilike("shareholder_name", `%${term}%`);
      if (event !== "all") query = query.contains("ownership_events", [{ kind: event }]);
      const { data, count, error: err } = await query;
      if (cancelled) return;
      if (err) { setError("Kunne ikke hente eierhistorikken. Prøv igjen."); setTotal(0); }
      else { setRows((data ?? []) as OwnershipHistory[]); setTotal(count ?? 0); }
      setBusy(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orgnr, page, search, event, retry]);

  const chart = useMemo(() => selected ? OWNERSHIP_YEARS.map(year => ({ year: String(year), pct: selected[`pct_${year}`] })) : [], [selected]);
  const playbooks = [
    { id: "historisk-majoritet", title: "Historisk majoritetsskifte", count: summary?.majority_count },
    { id: "historisk-oppbygging", title: "Eieroppbygging", count: summary?.increase_count },
    { id: "historisk-inngang", title: "Nye registrerte eiere", count: summary?.entry_count },
  ];

  return (
    <section className="space-y-4 border-t pt-5" aria-label="Navngitt eierhistorikk">
      <div>
        <h3 className="text-base font-semibold">Personeiere · full registerhistorikk 2022–2025</h3>
        <p className="text-xs text-muted-foreground mt-1">Alle direkte registrerte personeiere, uansett beholdning. — betyr ingen oppgitt eierandel. Navn + fødselsår er ikke en entydig personidentifikator.</p>
        <p className="text-xs text-muted-foreground">Årlige registerendringer er ikke dokumenterte kjøp/salg, kapitalutvidelser eller bevis på hvilken megler en person bruker. 2017–2021 er ikke innlastet.</p>
      </div>
      {summary && <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">{summary.owner_count.toLocaleString("nb-NO")} personeierposter</Badge>
        <Badge variant="outline">{summary.entry_count.toLocaleString("nb-NO")} innganger</Badge>
        <Badge variant="outline">{summary.exit_count.toLocaleString("nb-NO")} utganger</Badge>
        <Badge variant="outline">{summary.majority_count.toLocaleString("nb-NO")} majoritetsendringer</Badge>
        <Badge variant="outline">{summary.increase_count.toLocaleString("nb-NO")} økninger ≥20 pp</Badge>
        <Badge variant="outline">{summary.decrease_count.toLocaleString("nb-NO")} reduksjoner ≥20 pp</Badge>
      </div>}
      <div className="flex flex-wrap gap-2">
        {playbooks.map(p => <Button key={p.id} variant="outline" size="sm" asChild>
          <Link to={`/segments?playbook=${p.id}&company=${orgnr}`}>{p.title} ({p.count ?? "…"}) <ArrowRight className="ml-2 h-3 w-3" /></Link>
        </Button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Søk i personeiere" placeholder="Personnavn" className="max-w-xs" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <Select value={event} onValueChange={v => { setEvent(v); setPage(0); }}>
          <SelectTrigger className="w-56" aria-label="Historisk eierskapssignal"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Alle historiske signaler</SelectItem>{Object.entries(EVENT_LABELS).map(([kind, label]) => <SelectItem key={kind} value={kind}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {error ? <div role="alert" className="flex gap-2 items-center text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}<Button variant="outline" size="sm" onClick={() => setRetry(v => v + 1)}>Prøv igjen</Button></div> : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Personnavn</TableHead><TableHead>Født</TableHead>{OWNERSHIP_YEARS.map(y => <TableHead key={y} className="text-right">{y}</TableHead>)}<TableHead>Historiske signaler</TableHead></TableRow></TableHeader>
          <TableBody>
            {busy ? <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="inline h-4 w-4 animate-spin" /></TableCell></TableRow> : rows.map(r => <TableRow key={r.id} className={selected?.id === r.id ? "bg-muted" : ""}>
              <TableCell><Button variant="link" className="h-auto p-0 whitespace-normal text-left" onClick={() => setSelected(r)}>{r.shareholder_name}</Button></TableCell>
              <TableCell>{r.birth_year ?? "—"}</TableCell>
              {OWNERSHIP_YEARS.map(y => <TableCell key={y} className="text-right tabular-nums whitespace-nowrap" title={r[`shares_${y}`] == null ? "Ikke registrert dette året" : `${r[`shares_${y}`]?.toLocaleString("nb-NO")} aksjer`}>{formatPct(r[`pct_${y}`])}</TableCell>)}
              <TableCell><div className="flex flex-wrap gap-1">{ownershipEvents(r).map(e => <Badge key={`${e.from}-${e.kind}`} variant="outline" className="text-xs whitespace-nowrap">{e.from}→{e.to}: {EVENT_LABELS[e.kind]}{e.delta == null ? "" : ` (${e.delta > 0 ? "+" : ""}${e.delta.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} pp)`}</Badge>)}</div></TableCell>
            </TableRow>)}
            {!busy && !error && !rows.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Ingen personeiere med disse kriteriene.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-muted-foreground">{busy ? "Henter…" : `${total ? page * PAGE_SIZE + 1 : 0}–${Math.min((page + 1) * PAGE_SIZE, total)} av ${total.toLocaleString("nb-NO")} personeiere`}</span>
        <div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Forrige eierside" disabled={busy || page === 0} onClick={() => setPage(v => v - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="outline" aria-label="Neste eierside" disabled={busy || (page + 1) * PAGE_SIZE >= total} onClick={() => setPage(v => v + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
      {selected && <div className="space-y-2">
        <h4 className="text-sm font-medium">{selected.shareholder_name} · {selected.birth_year ?? "Ukjent fødselsår"}</h4>
        <div className="h-56"><ResponsiveContainer><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis unit=" %" domain={[0, "auto"]} /><Tooltip formatter={v => formatPct(Number(v))} /><Line dataKey="pct" name="Eierandel" stroke="hsl(var(--chart-2))" strokeWidth={2} connectNulls={false} /></LineChart></ResponsiveContainer></div>
      </div>}
    </section>
  );
}