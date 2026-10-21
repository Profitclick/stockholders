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
import { Download, Loader2 } from "lucide-react";
import Papa from "papaparse";

type Row = {
  orgnr: string; company: string | null; shareholder_name: string; birth_year: number | null;
  postal: string | null; pct_2025: number | null; pct_2024: number | null; change_type: string;
};

const CHANGES: Record<string, string> = {
  all: "Alle endringer", new: "Ny eier (2025)", increased: "Økt ≥5 pp", decreased: "Redusert ≥5 pp",
  exited: "Gått ut", unchanged: "Uendret",
};

export default function PersonOwners() {
  const { session, isAdmin, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [change, setChange] = useState("new");
  const [minPct, setMinPct] = useState("20");

  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(async () => {
      setBusy(true);
      let query = supabase.from("person_holdings")
        .select("orgnr,company,shareholder_name,birth_year,postal,pct_2025,pct_2024,change_type")
        .order("pct_2025", { ascending: false, nullsFirst: false }).limit(1000);
      if (change !== "all") query = query.eq("change_type", change);
      const m = Number(minPct);
      if (m > 0) query = change === "exited" ? query.gte("pct_2024", m) : query.gte("pct_2025", m);
      const s = q.trim();
      if (/^\d{9}$/.test(s)) query = query.eq("orgnr", s);
      else if (s) query = query.or(`shareholder_name.ilike.%${s.replace(/[,()]/g, "")}%,company.ilike.%${s.replace(/[,()]/g, "")}%`);
      const { data } = await query;
      setRows((data as Row[]) ?? []);
      setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [isAdmin, q, change, minPct]);

  if (loading) return <p className="text-muted-foreground">Laster…</p>;
  if (!session) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <p className="text-muted-foreground">Denne kontoen har ikke tilgang til personlister.</p>;

  function exportCsv() {
    const blob = new Blob([Papa.unparse(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `personeiere_${change}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Personeiere</h1>
          <p className="text-sm text-muted-foreground">
            Personer med direkte eierandel ≥5 % i fulgte selskaper, 2024 → 2025. Kun synlig for deg.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
          <Download className="mr-2 h-4 w-4" /> CSV ({rows.length})
        </Button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Input className="max-w-xs" placeholder="Navn, selskap eller org.nr" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={change} onValueChange={setChange}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(CHANGES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Input className="w-32" type="number" min={0} max={100} value={minPct} onChange={(e) => setMinPct(e.target.value)} aria-label="Minste eierandel %" />
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Aksjonær</TableHead><TableHead>Født</TableHead><TableHead>Sted</TableHead>
                <TableHead>Selskap</TableHead><TableHead className="text-right">2024 %</TableHead>
                <TableHead className="text-right">2025 %</TableHead><TableHead>Endring</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy ? (
                <TableRow><TableCell colSpan={7} className="text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Ingen treff.</TableCell></TableRow>
              ) : rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.shareholder_name}</TableCell>
                  <TableCell>{r.birth_year ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.postal ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.company}<span className="block font-mono text-xs text-muted-foreground">{r.orgnr}</span></TableCell>
                  <TableCell className="text-right font-mono">{r.pct_2024 ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.pct_2025 ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{CHANGES[r.change_type]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
