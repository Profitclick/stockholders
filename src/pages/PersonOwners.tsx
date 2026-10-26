import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, X } from "lucide-react";
import Papa from "papaparse";
import { DISPLAY_YEARS } from "@/lib/annualOwnership";
import { OWNERSHIP_YEARS, YEAR_COLUMNS } from "@/lib/ownershipHistory";
import { personYearValue, type PersonAnnualRow as Row } from "@/lib/personAnnualOwnership";
import { PersonAnnualPortfolio, formatPersonPct } from "@/components/PersonAnnualPortfolio";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { collectExportPages, MAX_EXPORT_ROWS } from "@/lib/exportLimits";
import { toast } from "sonner";

const TRENDS: Record<string, string> = {
  all: "Alle", new_2025: "Ny eier 2025", new_2024: "Ny eier 2024", new_2023: "Ny eier 2023", new_2022: "Ny eier 2022", new_2021: "Ny eier 2021", new_2020: "Ny eier 2020", new_2019: "Ny eier 2019", new_2018: "Ny eier 2018",
  increased: "Økt ≥1 pp", decreased: "Redusert ≥1 pp", exited: "Gått ut", stable: "Stabil",
};

export default function PersonOwners() {
  const { session, isAdmin, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [trend, setTrend] = useState("new_2025");
  const [minPct, setMinPct] = useState("20");
  const [person, setPerson] = useState<{ name: string; birth_year: number | null } | null>(null);
  const [view, setView] = useState("comparison");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setBusy(true); setRows([]); setError("");
    const t = setTimeout(async () => {
      // Search / person lookups use their own indexes; trend + min-% are applied in the browser
      // for those so the database never falls back to scanning millions of rows.
      let query = supabase.from("person_ownership_history")
        .select(`orgnr,company,shareholder_name,birth_year,postal,${YEAR_COLUMNS},trend,years_present,max_pct`)
        .limit(1000);
      const s = q.trim();
      const m = Number(minPct);
      let localFilter = false;
      if (person) {
        query = query.eq("shareholder_name", person.name);
        query = person.birth_year == null ? query.is("birth_year", null) : query.eq("birth_year", person.birth_year);
        query = query.order("orgnr");
      } else if (/^\d{9}$/.test(s)) {
        query = query.eq("orgnr", s);
        localFilter = true;
      } else if (s) {
        localFilter = true;
      } else {
        if (trend !== "all") query = query.eq("trend", trend);
        if (m > 0) query = query.gte("max_pct", m);
        query = query.order("max_pct", { ascending: false });
      }
      // Prefix search goes through a server function so the name/company indexes are used.
      const prefix = s.replace(/[%_\\]/g, "");
      const { data, error: queryError } = s && !person && !/^\d{9}$/.test(s)
        ? await supabase.rpc("search_ownership_history", { p_prefix: prefix, p_limit: 2000 })
        : await query;
      if (cancelled) return;
      if (queryError) { setError("Kunne ikke hente eierporteføljen. Prøv igjen."); setBusy(false); return; }
      let list = ((data as unknown as (Row & { max_pct: number | null })[]) ?? []);
      if (localFilter) {
        list = list.filter((r) => (trend === "all" || r.trend === trend) && (!(m > 0) || (r.max_pct ?? 0) >= m));
      }
      list.sort((a, b) => (b.max_pct ?? 0) - (a.max_pct ?? 0));
      setRows(list);
      setBusy(false);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [isAdmin, q, trend, minPct, person, retry]);

  if (loading) return <p className="text-muted-foreground">Laster…</p>;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <p className="text-muted-foreground">Denne kontoen har ikke tilgang til personlister.</p>;

  async function exportCsv() {
    setExporting(true);
    setExportCount(0);
    const parts: BlobPart[] = ["\uFEFF"];
    let afterId = 0;
    const search = q.trim();
    try {
      const count = await collectExportPages<Row>(async (_offset, size) => {
        const { data, error } = await supabase.rpc("ownership_export_page", {
          p_after_id: afterId, p_limit: size,
          p_prefix: /^\d{9}$/.test(search) ? "" : search,
          p_orgnr: /^\d{9}$/.test(search) ? search : undefined,
          p_person: person?.name, p_birth_year: person?.birth_year ?? undefined,
          p_trend: trend, p_min_pct: Number(minPct) || 0,
        });
        if (error) throw error;
        const page = data ?? [];
        const last = page.at(-1);
        if (last) afterId = last.id;
        return page;
      }, (page, first) => {
        const exported = page.map(row => ({
      orgnr: row.orgnr, company: row.company, shareholder_name: row.shareholder_name, birth_year: row.birth_year,
      ...Object.fromEntries(DISPLAY_YEARS.flatMap(year => [
        [`pct_${year}`, personYearValue(row, year)],
        [`shares_${year}`, personYearValue(row, year, "shares")],
        [`status_${year}`, OWNERSHIP_YEARS.some(y => y === year) ? "Innlastet" : "Ikke innlastet"],
      ])),
    }));
        parts.push((first ? "" : "\r\n") + Papa.unparse(exported, { header: first }));
      }, MAX_EXPORT_ROWS, setExportCount);
      if (count === 0) { toast.error("Ingen treff å eksportere."); return; }
    const blob = new Blob(parts, { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = person ? `portefolje_${person.name}.csv` : `personeiere_${trend}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
      toast.success(`${count.toLocaleString("nb-NO")} rader eksportert${count === MAX_EXPORT_ROWS ? " — eksportgrensen er nådd" : ""}`);
    } catch {
      toast.error("Eksporten feilet. Ingen ufullstendig fil ble lastet ned. Prøv igjen.");
    } finally { setExporting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Personeiere</h1>
          <p className="text-sm text-muted-foreground">
            Eierandeler 2017–2025. Alle årganger 2017–2025 er innlastet fra prosjektets egen lagring. Kun eiertilgang.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={busy || exporting || !rows.length || !!error}>
          {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} {exporting ? `Hentet ${exportCount.toLocaleString("nb-NO")}` : "CSV (maks 500 000)"}
        </Button>
      </div>
      {person ? (
        <div className="flex items-center gap-2">
          <Badge className="text-sm">Portefølje: {person.name} {person.birth_year ? `(f. ${person.birth_year})` : ""}</Badge>
          <Button size="sm" variant="ghost" onClick={() => setPerson(null)}><X className="mr-1 h-4 w-4" /> Tilbake</Button>
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <Input className="max-w-xs" placeholder="Navn (starter med), selskap eller org.nr" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={trend} onValueChange={setTrend}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(TRENDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="w-32" type="number" min={0} max={100} value={minPct} onChange={(e) => setMinPct(e.target.value)} aria-label="Minste eierandel %" />
        </div>
      )}
      {person && <>
        <p className="text-xs text-muted-foreground">Alle beholdninger i den hentede porteføljen, uavhengig av søkefiltrene. Navn og fødselsår er ikke en entydig personidentifikator.</p>
        <Tabs value={view} onValueChange={setView}><TabsList aria-label="Porteføljevisning"><TabsTrigger value="comparison">Sammenlign 2017–2025</TabsTrigger><TabsTrigger value="annual">Årstabeller</TabsTrigger></TabsList></Tabs>
      </>}
      <p className="text-xs text-muted-foreground">— betyr ingen oppgitt eierandel, ikke 0 %. Endringer i prosentpoeng er registerendringer, ikke dokumenterte kjøp eller salg.</p>
      {error && <div role="alert" className="flex items-center gap-2 text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={() => setRetry(v => v + 1)}>Prøv igjen</Button></div>}
      {person && view === "annual" ? busy ? <p className="text-sm text-muted-foreground">Henter portefølje…</p> : !error && <PersonAnnualPortfolio rows={rows} /> :
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aksjonær</TableHead><TableHead>Født</TableHead><TableHead>Sted</TableHead>
                <TableHead>Selskap</TableHead>
                {DISPLAY_YEARS.map((y) => <TableHead key={y} className="text-right whitespace-nowrap">{y}{!OWNERSHIP_YEARS.some(year => year === y) && <span className="block text-[10px] font-normal">Ikke innlastet</span>}</TableHead>)}
                <TableHead>Utvikling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy ? (
                <TableRow><TableCell colSpan={14} className="text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground">{error ? "Porteføljen kunne ikke hentes." : "Ingen treff."}</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    <Button variant="link" className="h-auto p-0 whitespace-normal text-left" onClick={() => setPerson({ name: r.shareholder_name, birth_year: r.birth_year })}>
                      {r.shareholder_name}
                    </Button>
                  </TableCell>
                  <TableCell>{r.birth_year ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.postal ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.company}<span className="block font-mono text-xs text-muted-foreground">{r.orgnr}</span></TableCell>
                  {DISPLAY_YEARS.map((y) => {
                    return <TableCell key={y} className="text-right tabular-nums whitespace-nowrap">{formatPersonPct(personYearValue(r, y))}</TableCell>;
                  })}
                  <TableCell><Badge variant="secondary">{TRENDS[r.trend] ?? r.trend}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>}
      {!busy && !error && <p className="text-xs text-muted-foreground">{rows.length.toLocaleString("nb-NO")} poster vist.{rows.length >= (q.trim() && !person && !/^\d{9}$/.test(q.trim()) ? 2000 : 1000) ? " Treffgrensen er nådd; utvalget er ikke nødvendigvis komplett." : ""}</p>}
    </div>
  );
}
