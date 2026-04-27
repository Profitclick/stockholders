import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Company {
  id: string;
  orgnr: string;
  name: string;
  industry: string | null;
  size: string | null;
  enriched: boolean;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  brreg_data: any;
  geo_context: any;
  eu_context: any;
  datanorge_context: any;
}

const PAGE_SIZE = 25;

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Company | null>(null);
  const [enriching, setEnriching] = useState(false);

  useEffect(() => { load(); }, [page, search]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from("companies")
      .select("*", { count: "exact" })
      .order("name")
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (search) query = query.ilike("name", `%${search}%`);
    const { data, count } = await query;
    setCompanies((data as Company[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }

  async function runEnrichment() {
    setEnriching(true);
    try {
      const { data, error } = await supabase.functions.invoke("mcp-enrich", { body: {} });
      if (error) throw error;
      toast.success(`Enrichment: ${data?.enriched ?? 0} companies processed, ${data?.errors ?? 0} errors`);
      load();
    } catch (err: any) {
      toast.error(`Enrichment failed: ${err.message}`);
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground">Companies</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary">{total.toLocaleString()} total</Badge>
          <Button onClick={runEnrichment} disabled={enriching} variant="outline" size="sm">
            {enriching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Enrich Companies
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search companies..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Org.nr</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Enriched</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>
              ) : companies.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No companies found. Run aggregation first.</TableCell></TableRow>
              ) : companies.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(c)}>
                  <TableCell className="font-mono text-sm">{c.orgnr}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.industry ?? "—"}</TableCell>
                  <TableCell>{c.size ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {c.email && <Badge variant="outline" className="text-xs">✉</Badge>}
                      {c.phone && <Badge variant="outline" className="text-xs">☎</Badge>}
                      {c.website && <Badge variant="outline" className="text-xs">🌐</Badge>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={c.enriched ? "default" : "secondary"}>{c.enriched ? "Yes" : "No"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Page {page + 1}</p>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>{selected?.name}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Org.nr:</span> {selected.orgnr}</div>
                <div><span className="text-muted-foreground">Industry:</span> {selected.industry ?? "—"}</div>
                <div><span className="text-muted-foreground">Size:</span> {selected.size ?? "—"}</div>
                <div><span className="text-muted-foreground">Enriched:</span> {selected.enriched ? "Yes" : "No"}</div>
              </div>
              {(selected.email || selected.phone || selected.website || selected.address) && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">Contact Info</p>
                  {selected.email && <p><span className="text-muted-foreground">Email:</span> {selected.email}</p>}
                  {selected.phone && <p><span className="text-muted-foreground">Phone:</span> {selected.phone}</p>}
                  {selected.website && <p><span className="text-muted-foreground">Website:</span> {selected.website}</p>}
                  {selected.address && <p><span className="text-muted-foreground">Address:</span> {selected.address}</p>}
                </div>
              )}
              {selected.brreg_data && Object.keys(selected.brreg_data).length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Brreg Data</p>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-40">{JSON.stringify(selected.brreg_data, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
