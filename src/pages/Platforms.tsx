import { useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { CompanyOwnerHistory } from "@/components/CompanyOwnerHistory";
import { AnnualPlatformOwnership } from "@/components/AnnualPlatformOwnership";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CATEGORY_ORDER, PLATFORM_BY_ID, PLATFORM_CATEGORIES, type PlatformCategory } from "@/lib/custodyPlatforms";

const YEARS = [2022, 2023, 2024, 2025];
const COLORS = [1, 2, 3, 4, 5].map((i) => `hsl(var(--chart-${i}))`);
const color = (i: number) => COLORS[i % COLORS.length];
const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${Number(v).toFixed(d)} %`);
const pp = (v: number | null | undefined) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)} pp`);
const nf = new Intl.NumberFormat("nb-NO");
const platName = (id: string | null) => (id ? PLATFORM_BY_ID[id]?.name ?? id : "–");

type Profile = Record<string, any> & { orgnr: string; company_name: string };
type Holding = { year: number; orgnr: string; platform_id: string; shares: number; pct: number; accounts: number };

export default function Platforms() {
  const { session, isAdmin, loading } = useAuth();
  const [params] = useSearchParams();
  if (loading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!session || !isAdmin) return <Navigate to="/auth" replace />;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">VPS og meglereksponering</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Hvor stor del av hvert selskap som ligger på forvalterkontoer hos nettmeglere, banker og meglerhus (2022–2025).
          Viser registrert forvalter — ikke hvem som eier bak kontoen, eller hvor en enkeltperson faktisk handler.
        </p>
      </div>
      <Tabs defaultValue={params.get("company") ? "company" : "overview"}>
        <TabsList>
          <TabsTrigger value="overview">Oversikt</TabsTrigger>
          <TabsTrigger value="company">Selskap</TabsTrigger>
          <TabsTrigger value="platform">Plattform</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="company"><CompanyView /></TabsContent>
        <TabsContent value="platform"><PlatformView /></TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardContent className="pt-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

function Overview() {
  const [stats, setStats] = useState<any>(null);
  const [byYear, setByYear] = useState<any[]>([]);
  const [top, setTop] = useState<{ id: string; companies: number; avg: number }[]>([]);

  useEffect(() => {
    supabase.from("platform_stats").select("stats").eq("year", 2025).maybeSingle().then(({ data }) => setStats(data?.stats));
    (async () => {
      const all: Holding[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from("company_platform_holdings").select("year,orgnr,platform_id,pct,accounts,shares").range(from, from + 999);
        if (!data?.length) break;
        all.push(...(data as Holding[]));
        if (data.length < 1000) break;
      }
      const yr = YEARS.map((y) => {
        const row: any = { year: String(y) };
        for (const c of CATEGORY_ORDER) {
          row[c] = new Set(all.filter((h) => h.year === y && PLATFORM_BY_ID[h.platform_id]?.category === c).map((h) => h.orgnr)).size;
        }
        return row;
      });
      setByYear(yr);
      const m = new Map<string, { n: number; s: number }>();
      for (const h of all.filter((h) => h.year === 2025)) {
        const e = m.get(h.platform_id) ?? { n: 0, s: 0 };
        e.n++; e.s += Number(h.pct);
        m.set(h.platform_id, e);
      }
      setTop([...m].map(([id, e]) => ({ id, companies: e.n, avg: e.s / e.n })).sort((a, b) => b.companies - a.companies).slice(0, 15));
    })();
  }, []);

  const dp = stats?.direct_vps_persons;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Selskaper med plattform-eierskap" value={stats ? nf.format(stats.companies_in_scope) : "…"} sub={stats ? `${stats.asa_companies} ASA` : ""} />
        <Stat label="Med nettmegler-eiere" value={stats ? nf.format(stats.companies_with_retail) : "…"} />
        <Stat label="Forvalterkontoer" value={stats ? nf.format(stats.nominee_accounts) : "…"} sub={stats ? `${stats.fund_accounts} fondskontoer` : ""} />
        <Stat label="Personer med VPS-aksjer i eget navn" value={dp ? nf.format(dp.persons) : "…"} sub={dp ? `${nf.format(dp.persons - dp.persons_prev)} flere enn 2024` : ""} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Selskaper per plattformtype, 2022–2025</CardTitle></CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer>
              <BarChart data={byYear}>
                <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis /><Tooltip /><Legend />
                {CATEGORY_ORDER.filter((c) => c !== "fund").map((c, i) => (
                  <Bar key={c} dataKey={c} name={PLATFORM_CATEGORIES[c].short} fill={color(i)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Største plattformer 2025</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Plattform</TableHead><TableHead className="text-right">Selskaper</TableHead><TableHead className="text-right">Snitt eierandel</TableHead></TableRow></TableHeader>
              <TableBody>
                {top.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{platName(t.id)} <span className="text-xs text-muted-foreground">{PLATFORM_CATEGORIES[PLATFORM_BY_ID[t.id]?.category as PlatformCategory]?.short}</span></TableCell>
                    <TableCell className="text-right">{t.companies}</TableCell>
                    <TableCell className="text-right">{pct(t.avg, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      {dp && (
        <Card>
          <CardHeader><CardTitle className="text-base">Personer som eier VPS-aksjer direkte (2025)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>Under 35 år: <b>{nf.format(dp.age_under_35)}</b></div>
            <div>35–54 år: <b>{nf.format(dp.age_35_54)}</b></div>
            <div>55–69 år: <b>{nf.format(dp.age_55_69)}</b></div>
            <div>70+ år: <b>{nf.format(dp.age_70_plus)}</b></div>
            <div>2+ selskaper: <b>{nf.format(dp.persons_2plus)}</b></div>
            <div>5+ selskaper: <b>{nf.format(dp.persons_5plus)}</b></div>
            <div>10+ selskaper: <b>{nf.format(dp.persons_10plus)}</b></div>
            <div>Aktive (≥3 kjøp/salg): <b>{nf.format(dp.persons_active_3plus)}</b></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CompanyView() {
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Profile[]>([]);
  const [sel, setSel] = useState<Profile | null>(null);
  const [hold, setHold] = useState<Holding[]>([]);
  const [loadedYears, setLoadedYears] = useState<number[]>([]);
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdError, setHoldError] = useState("");
  const [holdRetry, setHoldRetry] = useState(0);

  useEffect(() => {
    const orgnr = params.get("company");
    if (!orgnr || !/^\d{9}$/.test(orgnr)) return;
    let cancelled = false;
    supabase.from("company_platform_profile").select("*").eq("orgnr", orgnr).maybeSingle().then(({ data }) => {
      if (!cancelled && data) { setSel(data as Profile); setQ(orgnr); }
    });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const s = q.trim();
      let query = supabase.from("company_platform_profile").select("*").order("retail_pct", { ascending: false }).limit(50);
      if (/^\d{9}$/.test(s)) query = query.eq("orgnr", s);
      else if (s) query = query.ilike("company_name", `%${s}%`);
      const { data } = await query;
      setList((data as Profile[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!sel) return;
    let cancelled = false;
    setHold([]);
    setLoadedYears([]); setHoldBusy(true); setHoldError("");
    Promise.all([
      supabase.from("company_platform_holdings").select("*").eq("orgnr", sel.orgnr).order("year").order("platform_id"),
      supabase.from("platform_stats").select("stats").eq("year", 2025).maybeSingle(),
    ]).then(([holdings, stats]) => {
      if (cancelled) return;
      if (holdings.error || stats.error) setHoldError("Kunne ikke hente årstabellene. Prøv igjen.");
      else {
        setHold((holdings.data as Holding[]) ?? []);
        const metadata = stats.data?.stats;
        const years = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.history_years : null;
        setLoadedYears(Array.isArray(years) ? years.filter((y): y is number => typeof y === "number") : [...new Set((holdings.data ?? []).map(h => h.year))]);
      }
      setHoldBusy(false);
    });
    return () => { cancelled = true; };
  }, [sel, holdRetry]);

  const history = useMemo(() => YEARS.map((y) => {
    const row: any = { year: String(y) };
    for (const c of CATEGORY_ORDER) row[c] = +hold.filter((h) => h.year === y && PLATFORM_BY_ID[h.platform_id]?.category === c).reduce((s, h) => s + Number(h.pct), 0).toFixed(2);
    return row;
  }), [hold]);
  const usedCats = CATEGORY_ORDER.filter((c) => history.some((r) => r[c] > 0));

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
      <Card>
        <CardContent className="pt-4 space-y-2">
          <Input placeholder="Selskapsnavn eller org.nr." value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="text-xs text-muted-foreground">Sortert etter andel på nettmeglere</div>
          <div className="max-h-[600px] overflow-auto divide-y">
            {list.map((p) => (
              <Button variant="ghost" key={p.orgnr} onClick={() => setSel(p)} className={`w-full h-auto block text-left py-2 px-1 text-sm ${sel?.orgnr === p.orgnr ? "bg-muted" : ""}`}>
                <div className="font-medium truncate">{p.company_name}</div>
                <div className="text-xs text-muted-foreground">Nettmegler {pct(p.retail_pct)} · forvalter {pct(p.nominee_pct)}</div>
              </Button>
            ))}
            {!list.length && <div className="text-sm text-muted-foreground py-4">Ingen treff</div>}
          </div>
        </CardContent>
      </Card>
      {!sel ? (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">Velg et selskap for å se eierandel, eierhistorie og eierprofil.</CardContent></Card>
      ) : (
        <div className="space-y-4 min-w-0">
          <div>
            <h2 className="text-xl font-semibold">{sel.company_name}</h2>
            <div className="text-sm text-muted-foreground">Org.nr. {sel.orgnr} · {nf.format(sel.total_shareholders)} aksjonærer · {sel.is_asa && <Badge variant="secondary">ASA</Badge>}</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="På forvalterkontoer" value={pct(sel.nominee_pct)} sub={`${pp(sel.nominee_shift_pp)} fra 2024`} />
            <Stat label="Nettmeglere" value={pct(sel.retail_pct)} sub={`${pp(sel.retail_shift_pp)} fra 2024`} />
            <Stat label="Utenlandske institusjoner" value={pct(sel.foreign_institutional_pct)} sub={`${pp(sel.foreign_institutional_shift_pp)} fra 2024`} />
            <Stat label="Personer i eget navn" value={pct(sel.direct_person_pct)} sub={`${nf.format(sel.direct_person_count)} personer · ${pp(sel.direct_person_shift_pp)}`} />
          </div>
          <AnnualPlatformOwnership rows={hold} loadedYears={loadedYears} busy={holdBusy} error={holdError} />
          {holdError && <Button size="sm" variant="outline" onClick={() => setHoldRetry(v => v + 1)}>Prøv igjen</Button>}
          <Card>
            <CardHeader><CardTitle className="text-base">Eierhistorie 2022–2025 (andel per plattformtype)</CardTitle></CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis unit=" %" /><Tooltip /><Legend />
                  {usedCats.map((c, i) => <Line key={c} dataKey={c} name={PLATFORM_CATEGORIES[c].short} stroke={color(i)} strokeWidth={2} />)}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Eierprofil</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={[
                    { a: "<35", n: sel.persons_under_35 }, { a: "35–54", n: sel.persons_35_54 },
                    { a: "55–69", n: sel.persons_55_69 }, { a: "70+", n: sel.persons_70_plus },
                  ]}>
                    <XAxis dataKey="a" /><YAxis /><Tooltip /><Bar dataKey="n" name="Personaksjonærer" fill={color(0)} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1">
                <div>Største forvalter: <b>{platName(sel.dominant_platform_id)}</b> ({pct(sel.dominant_platform_pct)})</div>
                <div>Nye personaksjonærer 2025: <b>{sel.new_direct_persons ?? "–"}</b></div>
                <div>Personer som gikk ut: <b>{sel.exited_direct_persons ?? "–"}</b></div>
                <div>Nordisk bank {pct(sel.nordic_bank_pct)} · Meglerhus {pct(sel.nordic_broker_pct)} · Privatbank {pct(sel.private_bank_pct)}</div>
                <div>Global depot {pct(sel.global_custody_pct)} · Investeringsbank {pct(sel.investment_bank_pct)} · Fond {pct(sel.fund_pct)}</div>
              </div>
            </CardContent>
          </Card>
          <CompanyOwnerHistory key={sel.orgnr} orgnr={sel.orgnr} />
        </div>
      )}
    </div>
  );
}

function PlatformView() {
  const [pid, setPid] = useState("nordnet");
  const [rows, setRows] = useState<Holding[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [plats, setPlats] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    supabase.from("custody_platforms").select("id,name").order("sort_order").then(({ data }) => setPlats(data ?? []));
  }, []);
  useEffect(() => {
    supabase.from("company_platform_holdings").select("*").eq("platform_id", pid).order("pct", { ascending: false }).limit(1000).then(async ({ data }) => {
      const r = (data as Holding[]) ?? [];
      setRows(r);
      const ids = [...new Set(r.filter((h) => h.year === 2025).slice(0, 100).map((h) => h.orgnr))];
      if (ids.length) {
        const { data: p } = await supabase.from("company_platform_profile").select("orgnr,company_name").in("orgnr", ids);
        setNames(Object.fromEntries((p ?? []).map((x) => [x.orgnr, x.company_name])));
      }
    });
  }, [pid]);

  const trend = YEARS.map((y) => ({ year: String(y), companies: rows.filter((r) => r.year === y).length }));
  const prev = new Map(rows.filter((r) => r.year === 2024).map((r) => [r.orgnr, Number(r.pct)]));
  const cur = rows.filter((r) => r.year === 2025).slice(0, 100);

  return (
    <div className="space-y-4">
      <Select value={pid} onValueChange={setPid}>
        <SelectTrigger className="w-80"><SelectValue /></SelectTrigger>
        <SelectContent>{plats.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
      </Select>
      <Card>
        <CardHeader><CardTitle className="text-base">Antall selskaper med beholdning, 2022–2025</CardTitle></CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer>
            <BarChart data={trend}><XAxis dataKey="year" /><YAxis /><Tooltip /><Bar dataKey="companies" name="Selskaper" fill={color(1)} /></BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Største posisjoner 2025</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Selskap</TableHead><TableHead className="text-right">Eierandel</TableHead><TableHead className="text-right">Endring fra 2024</TableHead></TableRow></TableHeader>
            <TableBody>
              {cur.map((h) => {
                const p = prev.get(h.orgnr);
                return (
                  <TableRow key={h.orgnr}>
                    <TableCell>{names[h.orgnr] ?? h.orgnr}</TableCell>
                    <TableCell className="text-right">{pct(h.pct, 2)}</TableCell>
                    <TableCell className="text-right">{p == null ? <Badge variant="secondary">Ny</Badge> : pp(Number(h.pct) - p)}</TableCell>
                  </TableRow>
                );
              })}
              {!cur.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Ingen beholdning i 2025</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
