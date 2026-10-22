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

type Row = {
  orgnr: string; company: string | null; shareholder_name: string; birth_year: number | null;
  postal: string | null; pct_2022: number | null; pct_2023: number | null; pct_2024: number | null;
  pct_2025: number | null; trend: string; years_present: number;
};

const TRENDS: Record<string, string> = {
  all: "Alle", new_2025: "Ny eier 2025", new_2024: "Ny eier 2024", new_2023: "Ny eier 2023",
  increased: "Økt ≥1 pp", decreased: "Redusert ≥1 pp", exited: "Gått ut", stable: "Stabil",
};
const YEARS = [2022, 2023, 2024, 2025] as const;

export default function PersonOwners() {
  const { session, isAdmin, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [trend, setTrend] = useState("new_2025");
  const [minPct, setMinPct] = useState("20");
  const [person, setPerson] = useState<{ name: string; birth_year: number | null } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(async () => {
      setBusy(true);
      let query = supabase.from("person_ownership_history")
        .select("orgnr,company,shareholder_name,birth_year,postal,pct_2022,pct_2023,pct_2024,pct_2025,trend,years_present")
        .order("max_pct", { ascending: false }).limit(1000);
      if (person) {
        query = query.eq("shareholder_name", person.name);
        query = person.birth_year == null ? query.is("birth_year", null) : query.eq("birth_year", person.birth_year);
      } else {
        if (trend !== "all") query = query.eq("trend", trend);
        const m = Number(minPct);
        if (m > 0) query = query.gte("max_pct", m);
        const s = q.trim();
        if (/^\d{9}$/.test(s)) query = query.eq("orgnr", s);
        else if (s) {
          const clean = s.replace(/[,()%*]/g, "").toUpperCase();
          query = query.or(`shareholder_name.like.${clean}%,company.like.${clean}%`);
        }
      }
      const { data } = await query;
      setRows((data as Row[]) ?? []);
      setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [isAdmin, q, trend, minPct, person]);

  if (loading) return <p className="text-muted-foreground">Laster…</p>;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <p className="text-muted-foreground">Denne kontoen har ikke tilgang til personlister.</p>;

  function exportCsv() {
    const blob = new Blob([Papa.unparse(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = person ? `portefolje_${person.name}.csv` : `personeiere_${trend}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Personeiere</h1>
          <p className="text-sm text-muted-foreground">
            Alle personlige aksjonærer i Aksjonærregisteret 2022–2025, med eierandel per år. Kun synlig for deg.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-2 h-4 w-4" /> CSV ({rows.length})
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
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aksjonær</TableHead><TableHead>Født</TableHead><TableHead>Sted</TableHead>
                <TableHead>Selskap</TableHead>
                {YEARS.map((y) => <TableHead key={y} className="text-right">{y} %</TableHead>)}
                <TableHead>Utvikling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy ? (
                <TableRow><TableCell colSpan={9} className="text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Ingen treff.</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">
                    <button className="text-left hover:underline text-primary" onClick={() => setPerson({ name: r.shareholder_name, birth_year: r.birth_year })}>
                      {r.shareholder_name}
                    </button>
                  </TableCell>
                  <TableCell>{r.birth_year ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.postal ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.company}<span className="block font-mono text-xs text-muted-foreground">{r.orgnr}</span></TableCell>
                  {YEARS.map((y) => {
                    const v = r[`pct_${y}` as keyof Row] as number | null;
                    return <TableCell key={y} className="text-right font-mono">{v ?? "—"}</TableCell>;
                  })}
                  <TableCell><Badge variant="secondary">{TRENDS[r.trend] ?? r.trend}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
