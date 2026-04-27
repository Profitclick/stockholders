import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

interface Investor {
  id: string;
  name: string;
  type: string | null;
  birth_year: number | null;
  gender: string | null;
  municipality: string | null;
  region: string | null;
  portfolio_size: number;
  ias_score: number;
  risk_score: number;
  sector_score: number;
  capital_score: number;
  velocity_score: number;
  capital_estimate: number;
  portfolio_companies: any;
  portfolio_industries: any;
  yoy_changes: any;
  ssb_context: any;
  brreg_context: any;
  custom_scores: any;
  demographics: any;
}

const PAGE_SIZE = 25;

export default function Investors() {
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Investor | null>(null);

  useEffect(() => { load(); }, [page, search]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from("investors")
      .select("*", { count: "exact" })
      .order("ias_score", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.ilike("name", `%${search}%`);
    const { data, count } = await query;
    setInvestors((data as Investor[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Investors</h1>
        <Badge variant="secondary">{total.toLocaleString()} total</Badge>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search investors..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Municipality</TableHead>
                <TableHead className="text-right">Portfolio</TableHead>
                <TableHead className="text-right">IAS</TableHead>
                <TableHead className="text-right">Risk</TableHead>
                <TableHead className="text-right">Sector</TableHead>
                <TableHead className="text-right">Capital</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : investors.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No investors found. Import data to get started.</TableCell></TableRow>
              ) : investors.map((inv) => (
                <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(inv)}>
                  <TableCell className="font-medium">{inv.name}</TableCell>
                  <TableCell><Badge variant={inv.type === "AS" ? "default" : "secondary"}>{inv.type ?? "—"}</Badge></TableCell>
                  <TableCell>{inv.municipality ?? "—"}</TableCell>
                  <TableCell className="text-right">{inv.portfolio_size}</TableCell>
                  <TableCell className="text-right font-mono">{(inv.ias_score ?? 0).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{(inv.risk_score ?? 0).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{(inv.sector_score ?? 0).toFixed(1)}</TableCell>
                  <TableCell className="text-right font-mono">{(inv.capital_score ?? 0).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</p>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>{selected?.name}</DialogTitle></DialogHeader>
          {selected && (
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="scores">Scores</TabsTrigger>
                <TabsTrigger value="raw">Raw Data</TabsTrigger>
                <TabsTrigger value="enriched">Enriched</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="space-y-3 mt-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Type:</span> {selected.type ?? "—"}</div>
                  <div><span className="text-muted-foreground">Birth Year:</span> {selected.birth_year ?? "—"}</div>
                  <div><span className="text-muted-foreground">Gender:</span> {selected.gender ?? "—"}</div>
                  <div><span className="text-muted-foreground">Municipality:</span> {selected.municipality ?? "—"}</div>
                  <div><span className="text-muted-foreground">Region:</span> {selected.region ?? "—"}</div>
                  <div><span className="text-muted-foreground">Portfolio Size:</span> {selected.portfolio_size}</div>
                  <div><span className="text-muted-foreground">Capital Estimate:</span> {selected.capital_estimate?.toLocaleString()}</div>
                </div>
              </TabsContent>
              <TabsContent value="scores" className="mt-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "IAS Score", value: selected.ias_score },
                    { label: "Risk Score", value: selected.risk_score },
                    { label: "Sector Score", value: selected.sector_score },
                    { label: "Capital Score", value: selected.capital_score },
                    { label: "Velocity Score", value: selected.velocity_score },
                  ].map((s) => (
                    <Card key={s.label}>
                      <CardContent className="p-3 text-center">
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-2xl font-bold">{(s.value ?? 0).toFixed(1)}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-48 mt-4">
                  {JSON.stringify(selected.custom_scores, null, 2)}
                </pre>
              </TabsContent>
              <TabsContent value="raw" className="mt-4">
                <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-96">
                  {JSON.stringify({ portfolio_companies: selected.portfolio_companies, yoy_changes: selected.yoy_changes, demographics: selected.demographics }, null, 2)}
                </pre>
              </TabsContent>
              <TabsContent value="enriched" className="mt-4">
                <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-96">
                  {JSON.stringify({ ssb_context: selected.ssb_context, brreg_context: selected.brreg_context }, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
