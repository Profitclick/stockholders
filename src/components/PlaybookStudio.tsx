import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { collectExportPages, exportLimit, MAX_EXPORT_ROWS } from "@/lib/exportLimits";
import { RetailMarketTargets } from "@/components/RetailMarketTargets";

type SignalRow = {
  orgnr: string;
  name: string;
  industry: string | null;
  nace_code: string | null;
  municipality: string | null;
  revenue: number | null;
  operating_profit: number | null;
  profit_margin: number | null;
  company_age_years: number | null;
  ceo_name: string | null;
  chair_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  has_majority_change: boolean;
  has_new_shareholder: boolean;
  has_capital_increase: boolean;
  skattefunn_count: number;
  grants_count: number;
  eu_grants_count: number;
  research_council_count: number;
  contract_count: number;
  contract_value: number;
  lead_score: number;
  owner_count?: number;
  entry_count?: number;
  exit_count?: number;
  majority_count?: number;
  increase_count?: number;
  decrease_count?: number;
};

const SELECT_COLS =
  "orgnr,name,industry,nace_code,municipality,revenue,operating_profit,profit_margin,company_age_years,ceo_name,chair_name,email,phone,website,has_majority_change,has_new_shareholder,has_capital_increase,skattefunn_count,grants_count,eu_grants_count,research_council_count,contract_count,contract_value,lead_score";

interface Playbook {
  id: string;
  title: string;
  pitch: string;
  historical?: boolean;
  apply: (q: any) => any;
}

const PLAYBOOKS: Playbook[] = [
  {
    id: "historisk-majoritet", title: "Historisk majoritetsskifte", historical: true,
    pitch: "Personandel krysset 50 % i minst ett av årsintervallene 2017–2025.",
    apply: (q) => q.gt("majority_count", 0),
  },
  {
    id: "historisk-oppbygging", title: "Eieroppbygging", historical: true,
    pitch: "Direkte registrerte personeiere har økt andelen med minst 20 prosentpoeng mellom to registerår.",
    apply: (q) => q.gt("increase_count", 0),
  },
  {
    id: "historisk-inngang", title: "Nye registrerte eiere", historical: true,
    pitch: "Personposter som kommer inn i registeret i 2023, 2024 eller 2025, uansett beholdning.",
    apply: (q) => q.gt("entry_count", 0),
  },
  {
    id: "retail-investorer", title: "Retail-investorer & småsparere", historical: true,
    pitch: "Selskaper med mange direkte personeiere og både inngang og utgang av eiere 2017–2025 — der aktive småsparere roterer. Brukes til målgruppe-/lookalike-analyse, ikke direkte kontakt med privatpersoner.",
    apply: (q) => q.gte("owner_count", 20).gt("entry_count", 0).gt("exit_count", 0),
  },
  {
    id: "eierskifte",
    title: "Eierskifte & exit",
    pitch: "Selskaper med nylig majoritetsskifte og reell omsetning — modne for rådgivning, finansiering og integrasjon.",
    apply: (q) => q.eq("has_majority_change", true).gte("revenue", 5_000_000),
  },
  {
    id: "generasjonsskifte",
    title: "Generasjonsskifte",
    pitch: "Eldre, lønnsomme selskaper uten eierendring ennå — de mest sannsynlige salgs- og oppkjøpskandidatene.",
    apply: (q) =>
      q.gte("company_age_years", 20).gte("revenue", 10_000_000).gte("profit_margin", 5).eq("has_majority_change", false),
  },
  {
    id: "vekstkapital",
    title: "Vekstkapital",
    pitch: "Kapitalutvidelser og nye eiere inn — friske midler og investeringsvilje akkurat nå.",
    apply: (q) => q.or("has_capital_increase.eq.true,has_new_shareholder.eq.true").gte("revenue", 1_000_000),
  },
  {
    id: "fou",
    title: "FoU & SkatteFUNN",
    pitch: "Selskaper med SkatteFUNN, Forskningsrådet- eller EU-midler — innovasjonsdrevne og tilskuddsvante kjøpere.",
    apply: (q) => q.or("skattefunn_count.gt.0,research_council_count.gt.0,eu_grants_count.gt.0,grants_count.gt.0"),
  },
  {
    id: "offentlig",
    title: "Offentlige kontraktsvinnere",
    pitch: "Leverandører som har vunnet offentlige kontrakter på Doffin — dokumentert betalingsevne og leveransekapasitet.",
    apply: (q) => q.gt("contract_count", 0),
  },
  {
    id: "lonnsom-vekst",
    title: "Lønnsom mellomstor",
    pitch: "Solid drift i mellomsjiktet — den mest kjøpesterke B2B-målgruppen i Norge.",
    apply: (q) => q.gte("revenue", 10_000_000).lte("revenue", 500_000_000).gte("profit_margin", 8),
  },
];

const nf = new Intl.NumberFormat("nb-NO");
const money = (v: number | null) => (v == null ? "—" : nf.format(Math.round(v)));

export function PlaybookStudio() {
  const [params, setParams] = useSearchParams();
  const companyScope = params.get("company");
  const validCompany = companyScope && /^\d{9}$/.test(companyScope) ? companyScope : null;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<string>(() => PLAYBOOKS.some(p => p.id === params.get("playbook")) ? String(params.get("playbook")) : "eierskifte");
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const [minScore, setMinScore] = useState(validCompany ? "0" : "40");
  const [minRevenue, setMinRevenue] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [needSkattefunn, setNeedSkattefunn] = useState(false);
  const [needContract, setNeedContract] = useState(false);
  const [needContact, setNeedContact] = useState(false);
  const [limit, setLimit] = useState(String(MAX_EXPORT_ROWS));
  const [exporting, setExporting] = useState(false);
  const [exportCount, setExportCount] = useState(0);

  const playbook = useMemo(() => PLAYBOOKS.find((p) => p.id === active) ?? PLAYBOOKS[0], [active]);

  useEffect(() => {
    const id = params.get("playbook");
    if (id && PLAYBOOKS.some(p => p.id === id)) setActive(id);
    if (validCompany) setMinScore("0");
  }, [params, validCompany]);

  const buildQuery = useCallback(
    (pb: Playbook, head: boolean, exportPage?: { offset: number; size: number }) => {
      const cols = pb.historical ? `${SELECT_COLS},owner_count,entry_count,exit_count,majority_count,increase_count,decrease_count` : SELECT_COLS;
      const base = pb.historical
        ? supabase.from("historical_playbook_candidates").select(head ? "orgnr" : cols, { count: "exact", head })
        : supabase.from("company_signals").select(head ? "orgnr" : cols, { count: "exact", head });
      let q = pb.apply(base);
      if (validCompany) q = q.eq("orgnr", validCompany);
      if (!head) {
        const score = Number(minScore);
        if (!Number.isNaN(score) && score > 0) q = q.gte("lead_score", score);
        const rev = Number(minRevenue);
        if (minRevenue && !Number.isNaN(rev)) q = q.gte("revenue", rev);
        if (municipality.trim()) q = q.ilike("municipality", `%${municipality.trim()}%`);
        if (needSkattefunn) q = q.gt("skattefunn_count", 0);
        if (needContract) q = q.gt("contract_count", 0);
        if (needContact) q = q.not("ceo_name", "is", null);
        q = q.order("lead_score", { ascending: false }).order("orgnr");
        q = exportPage ? q.range(exportPage.offset, exportPage.offset + exportPage.size - 1) : q.limit(Math.min(exportLimit(Number(limit)), 1000));
      }
      return q;
    },
    [minScore, minRevenue, municipality, needSkattefunn, needContract, needContact, limit, validCompany],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        PLAYBOOKS.map(async (pb) => {
          const { count } = await buildQuery(pb, true);
          return [pb.id, count ?? 0] as const;
        }),
      );
      if (!cancelled) setCounts(Object.fromEntries(results));
    })();
    return () => {
      cancelled = true;
    };
    // counts are preset-only; filters do not apply to the cards
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validCompany, refreshing]);

  const runPlaybook = useCallback(async () => {
    setLoading(true);
    setRows([]);
    try {
      const { data, error, count } = await buildQuery(playbook, false);
      if (error) throw error;
      setRows((data as unknown as SignalRow[]) ?? []);
      setTotal(count ?? 0);
    } catch (err: any) {
      setTotal(0);
      toast.error(`Kunne ikke hente kandidater: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [buildQuery, playbook]);

  useEffect(() => {
    runPlaybook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, validCompany]);

  async function refreshSignals() {
    setRefreshing(true);
    try {
      const { error } = await supabase.rpc("refresh_company_signals");
      if (error) throw error;
      const { error: historyError } = await supabase.rpc("refresh_historical_ownership_signals");
      if (historyError) throw historyError;
      toast.success("Signaler oppdatert");
      await runPlaybook();
    } catch (err: any) {
      toast.error(`Oppdatering feilet: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  }

  async function ingestDoffin() {
    setIngesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("doffin-ingest", {
        body: { date_from: "2024-01-01" },
      });
      if (error) throw error;
      toast.success("Henter offentlige kontrakter i bakgrunnen", {
        description: `Jobb ${String(data?.job_id ?? "").slice(0, 8)} — følg fremdriften i banneret øverst.`,
      });
    } catch (err: any) {
      toast.error(`Kunne ikke starte innhenting: ${err.message}`);
    } finally {
      setIngesting(false);
    }
  }

  async function exportRows(fmt: "csv" | "xlsx") {
    if (rows.length === 0) {
      toast.error("Ingen kandidater å eksportere");
      return;
    }
    setExporting(true);
    setExportCount(0);
    const parts: BlobPart[] = ["\uFEFF"];
    const worksheet = XLSX.utils.aoa_to_sheet([]);
    try {
    const count = await collectExportPages<SignalRow>(async (offset, size) => {
      const { data, error } = await buildQuery(playbook, false, { offset, size });
      if (error) throw error;
      return (data as unknown as SignalRow[]) ?? [];
    }, (page, first) => {
    const flat = page.map((r) => ({
      Orgnr: r.orgnr,
      Selskap: r.name,
      Bransje: r.industry ?? "",
      "NACE": r.nace_code ?? "",
      Kommune: r.municipality ?? "",
      Omsetning: r.revenue ?? "",
      Driftsresultat: r.operating_profit ?? "",
      "Margin %": r.profit_margin ?? "",
      "Alder (år)": r.company_age_years ?? "",
      "Daglig leder": r.ceo_name ?? "",
      Styreleder: r.chair_name ?? "",
      "E-post": r.email ?? "",
      Telefon: r.phone ?? "",
      Nettsted: r.website ?? "",
      Majoritetsskifte: r.has_majority_change ? "Ja" : "Nei",
      "Ny aksjonær": r.has_new_shareholder ? "Ja" : "Nei",
      Kapitalutvidelse: r.has_capital_increase ? "Ja" : "Nei",
      SkatteFUNN: r.skattefunn_count,
      Tilskudd: r.grants_count,
      "EU-tildelinger": r.eu_grants_count,
      Forskningsrådet: r.research_council_count,
      "Offentlige kontrakter": r.contract_count,
      "Kontraktsverdi": r.contract_value,
      Leadscore: r.lead_score,
      ...(playbook.historical ? {
        "Historikkperiode": "2017–2025",
        "Personeierposter": r.owner_count ?? 0,
        "Registerinnganger": r.entry_count ?? 0,
        "Registerutganger": r.exit_count ?? 0,
        "Historiske majoritetsendringer": r.majority_count ?? 0,
        "Økninger ≥20 pp": r.increase_count ?? 0,
        "Reduksjoner ≥20 pp": r.decrease_count ?? 0,
      } : {}),
    }));

    if (fmt === "xlsx") XLSX.utils.sheet_add_json(worksheet, flat, { origin: first ? 0 : -1, skipHeader: !first });
    else parts.push((first ? "" : "\r\n") + Papa.unparse(flat, { header: first }));
    }, exportLimit(Number(limit)), setExportCount);
    if (count === 0) { toast.error("Ingen kandidater å eksportere"); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `playbook_${playbook.id}_${stamp}.${fmt}`;

    if (fmt === "xlsx") {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, worksheet, "Leads");
      XLSX.writeFile(wb, filename);
    } else {
      const blob = new Blob(parts, { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
    toast.success(`${nf.format(count)} leads eksportert${count === exportLimit(Number(limit)) ? " — eksportgrensen er nådd" : ""}`);
    } catch {
      toast.error("Eksporten feilet. Ingen ufullstendig fil ble lastet ned. Prøv igjen.");
    } finally { setExporting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Kommersielle playbooks
          </h2>
          <p className="text-sm text-muted-foreground">
            Ferdige kandidatlister bygget på eierskap, Brreg-regnskap, tilskudd og offentlige kontrakter.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={ingestDoffin} disabled={ingesting}>
            {ingesting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Hent Doffin-kontrakter
          </Button>
          <Button variant="outline" size="sm" onClick={refreshSignals} disabled={refreshing}>
            {refreshing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
            Oppdater signaler
          </Button>
        </div>
      </div>

      {validCompany && <div className="flex flex-wrap gap-2 items-center text-sm">
        <Badge variant="secondary">Selskap {validCompany}</Badge>
        <Button size="sm" variant="outline" onClick={() => { const next = new URLSearchParams(params); next.delete("company"); setParams(next); }}>Vis alle selskaper</Button>
        <Button size="sm" variant="link" asChild><Link to={`/plattformer?company=${validCompany}`}>Tilbake til eierprofil</Link></Button>
      </div>}
      {playbook.historical && <p className="text-xs text-muted-foreground">2017–2025 · direkte registrerte personeiere · selskaper med beriket selskapsprofil. Inngang/utgang er registerobservasjoner, ikke dokumenterte handler. Eksisterende leadscore beholdes; signalene gir ikke automatisk kontaktgrunnlag.</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLAYBOOKS.map((pb) => (
          <button key={pb.id} type="button" onClick={() => setActive(pb.id)} className="text-left">
            <Card
              className={`h-full transition-colors ${
                active === pb.id ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40"
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{pb.title}</CardTitle>
                  <Badge variant={active === pb.id ? "default" : "secondary"}>
                    {counts[pb.id] != null ? nf.format(counts[pb.id]) : "…"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground leading-relaxed">{pb.pitch}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>
      {active === "retail-investorer" && <RetailMarketTargets />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Filtre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Min. leadscore</Label>
              <Input type="number" value={minScore} onChange={(e) => setMinScore(e.target.value)} min="0" max="100" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Min. omsetning (NOK)</Label>
              <Input type="number" value={minRevenue} onChange={(e) => setMinRevenue(e.target.value)} placeholder="f.eks. 5000000" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kommune</Label>
              <Input value={municipality} onChange={(e) => setMunicipality(e.target.value)} placeholder="f.eks. Bergen" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Maks antall i eksport</Label>
              <Input aria-label="Maks antall i eksport" type="number" value={limit} onChange={(e) => setLimit(e.target.value)} min="1" max={MAX_EXPORT_ROWS} disabled={exporting} />
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={needSkattefunn} onCheckedChange={(v) => setNeedSkattefunn(Boolean(v))} />
              Kun med SkatteFUNN
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={needContract} onCheckedChange={(v) => setNeedContract(Boolean(v))} />
              Kun med offentlig kontrakt
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={needContact} onCheckedChange={(v) => setNeedContact(Boolean(v))} />
              Kun med navngitt daglig leder
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={runPlaybook} disabled={loading || exporting}>
              {loading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Kjør playbook
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRows("csv")} disabled={rows.length === 0 || loading || exporting}>
              <Download className="mr-2 h-3 w-3" /> CSV
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportRows("xlsx")} disabled={rows.length === 0 || loading || exporting}>
              <Download className="mr-2 h-3 w-3" /> Excel
            </Button>
            <span className="self-center text-xs text-muted-foreground">
              {exporting ? `Eksport: ${nf.format(exportCount)} rader hentet` : loading ? "Henter…" : `${nf.format(rows.length)} vist av ${nf.format(total)} treff`}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Selskap</TableHead>
                <TableHead>Kommune</TableHead>
                <TableHead className="text-right">Omsetning</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead>Signaler</TableHead>
                <TableHead>Kontakt</TableHead>
                <TableHead className="text-right">Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Henter kandidater…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Ingen treff. Senk leadscore eller fjern filtre.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.orgnr}>
                    <TableCell>
                      <div className="font-medium text-sm">{r.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {r.orgnr} · {r.industry ?? r.nace_code ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.municipality ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{money(r.revenue)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.profit_margin != null ? `${r.profit_margin}%` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.has_majority_change && <Badge variant="default" className="text-[10px]">Eierskifte</Badge>}
                        {r.has_capital_increase && <Badge variant="secondary" className="text-[10px]">Kapital</Badge>}
                        {r.has_new_shareholder && <Badge variant="secondary" className="text-[10px]">Ny eier</Badge>}
                        {(r.majority_count ?? 0) > 0 && <Badge variant="outline">Historisk majoritet ×{r.majority_count}</Badge>}
                        {(r.entry_count ?? 0) > 0 && <Badge variant="outline">Innganger ×{r.entry_count}</Badge>}
                        {(r.exit_count ?? 0) > 0 && <Badge variant="outline">Utganger ×{r.exit_count}</Badge>}
                        {(r.increase_count ?? 0) > 0 && <Badge variant="outline">Økt ≥20 pp ×{r.increase_count}</Badge>}
                        {(r.decrease_count ?? 0) > 0 && <Badge variant="outline">Redusert ≥20 pp ×{r.decrease_count}</Badge>}
                        {r.skattefunn_count > 0 && <Badge variant="outline" className="text-[10px]">SkatteFUNN</Badge>}
                        {r.grants_count > 0 && <Badge variant="outline" className="text-[10px]">Tilskudd</Badge>}
                        {r.eu_grants_count > 0 && <Badge variant="outline" className="text-[10px]">EU</Badge>}
                        {r.contract_count > 0 && (
                          <Badge variant="outline" className="text-[10px]">Doffin ×{r.contract_count}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.ceo_name ?? r.chair_name ?? "—"}
                      {r.website && <div className="text-muted-foreground truncate max-w-[160px]">{r.website}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{r.lead_score}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default PlaybookStudio;
