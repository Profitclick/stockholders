import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Upload, Settings, FileText, Trash2, Loader2, RotateCcw, Zap, Link2 } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface Plugin {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  config: any;
  dataset_type: string | null;
  row_count: number;
  created_at: string;
}

interface PluginLog {
  id: string;
  plugin_id: string;
  action: string;
  details: any;
  created_at: string;
}

const BATCH_SIZE = 5000;

const MCP_TEMPLATES = [
  { id: "grants", name: "Tilskudd (Innovasjon Norge/Enova)", desc: "Innvilgede tilskudd med beløp, dato og kategori", icon: "💰" },
  { id: "skattefunn", name: "SkatteFUNN", desc: "Godkjente FoU-prosjekter med skattefradrag", icon: "🔬" },
  { id: "research_council", name: "Forskningsrådet", desc: "NFR-tildelinger, prosjekttittel og periode", icon: "🎓" },
  { id: "eu_grants", name: "EU-tildelinger", desc: "Horizon Europe, ERC og andre EU-programmer", icon: "🇪🇺" },
];

function parseFile(file: File): Promise<Record<string, unknown>[]> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  
  if (ext === "json" || ext === "jsonl") {
    return file.text().then((text) => {
      if (ext === "jsonl") {
        return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      }
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : parsed?.data && Array.isArray(parsed.data) ? parsed.data : [parsed];
    });
  }

  if (ext === "xlsx" || ext === "xls") {
    return file.arrayBuffer().then((buf) => {
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    });
  }

  // Default: CSV
  return file.text().then((text) => {
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    return parsed.data as Record<string, unknown>[];
  });
}

export default function Plugins() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTab, setCreateTab] = useState("upload");
  const [configOpen, setConfigOpen] = useState<Plugin | null>(null);
  const [logsOpen, setLogsOpen] = useState<Plugin | null>(null);
  const [logs, setLogs] = useState<PluginLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newType, setNewType] = useState("plugin");
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [configJson, setConfigJson] = useState("");
  const [fetchingTemplate, setFetchingTemplate] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("plugins").select("*").order("name");
    setPlugins((data as Plugin[]) ?? []);
    setLoading(false);
  }

  async function toggle(id: string, enabled: boolean) {
    await supabase.from("plugins").update({ enabled }).eq("id", id);
    await supabase.from("plugin_logs" as any).insert({ plugin_id: id, action: enabled ? "enabled" : "disabled", details: {} });
    toast.success(`Plugin ${enabled ? "enabled" : "disabled"}`);
    load();
  }

  async function deletePlugin(p: Plugin) {
    if (!confirm(`Delete plugin "${p.name}" and all its data?`)) return;
    await supabase.from("plugins").delete().eq("id", p.id);
    await supabase.from("audit_log").insert({ action: "plugin_deleted", entity_type: "plugin", entity_id: p.id, details: { name: p.name, row_count: p.row_count } });
    toast.success("Plugin deleted");
    load();
  }

  async function handleCreate() {
    if (!newName.trim() || !dataFile) {
      toast.error("Name and data file are required");
      return;
    }
    setImporting(true);
    setImportProgress(0);

    try {
      const allRows = await parseFile(dataFile);
      if (allRows.length === 0) { toast.error("File is empty"); setImporting(false); return; }

      const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);
      const pluginId = crypto.randomUUID();

      const { data: job } = await supabase.from("jobs").insert({
        type: `plugin_import:${newName}`,
        status: "running",
        total_batches: totalBatches,
        metadata: { plugin_id: pluginId, filename: dataFile.name },
      }).select("id").single();
      if (!job) throw new Error("Failed to create job");

      for (let i = 0; i < totalBatches; i++) {
        const batch = allRows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const { error } = await supabase.functions.invoke("plugin-import", {
          body: { rows: batch, plugin_id: pluginId, plugin_name: newName.trim(), plugin_description: newDesc.trim() || null, dataset_type: newType, config: {}, job_id: job.id, batch_index: i, total_batches: totalBatches },
        });
        if (error) throw error;
        setImportProgress(((i + 1) / totalBatches) * 100);
      }

      toast.success(`Plugin "${newName}" created with ${allRows.length.toLocaleString()} rows`);
      setCreateOpen(false);
      resetCreateForm();
      load();
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  }

  async function startMcpFetch(templateId: string) {
    const tpl = MCP_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setFetchingTemplate(templateId);

    try {
      const pluginId = crypto.randomUUID();
      const { data: job } = await supabase.from("jobs").insert({
        type: `mcp_fetch:${tpl.name}`,
        status: "running",
        total_batches: 0,
        metadata: { plugin_id: pluginId, template_id: templateId },
      }).select("id").single();
      if (!job) throw new Error("Failed to create job");

      // Create plugin record
      await supabase.from("plugins").insert({
        id: pluginId,
        name: tpl.name,
        description: tpl.desc,
        dataset_type: templateId,
        config: { template: templateId },
        row_count: 0,
        enabled: true,
      });

      // Start MCP fetch chain
      await supabase.functions.invoke("plugin-mcp-fetch", {
        body: { template_id: templateId, plugin_id: pluginId, job_id: job.id },
      });

      toast.success(`Started fetching ${tpl.name} data. This runs in the background.`);
      setCreateOpen(false);
      load();
    } catch (err: any) {
      toast.error(`Failed to start: ${err.message}`);
    } finally {
      setFetchingTemplate(null);
    }
  }

  function resetCreateForm() {
    setNewName("");
    setNewDesc("");
    setNewType("plugin");
    setDataFile(null);
    setImportProgress(0);
    setCreateTab("upload");
  }

  async function openLogs(p: Plugin) {
    setLogsOpen(p);
    setLogsLoading(true);
    const { data } = await supabase.from("plugin_logs" as any).select("*").eq("plugin_id", p.id).order("created_at", { ascending: false }).limit(100);
    setLogs((data as unknown as PluginLog[]) ?? []);
    setLogsLoading(false);
  }

  function openConfig(p: Plugin) {
    setConfigOpen(p);
    setConfigJson(JSON.stringify(p.config ?? {}, null, 2));
  }

  async function saveConfig() {
    if (!configOpen) return;
    try {
      const parsed = JSON.parse(configJson);
      await supabase.from("plugins").update({ config: parsed }).eq("id", configOpen.id);
      await supabase.from("plugin_logs" as any).insert({ plugin_id: configOpen.id, action: "config_updated", details: { config: parsed } });
      toast.success("Configuration saved");
      setConfigOpen(null);
      load();
    } catch {
      toast.error("Invalid JSON");
    }
  }

  async function handleReimportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const p = (window as any).__reimportPlugin as Plugin | undefined;
    if (!file || !p) return;

    setImporting(true);
    setImportProgress(0);
    try {
      await supabase.from("plugin_data" as any).delete().eq("plugin_id", p.id);
      const allRows = await parseFile(file);
      const totalBatches = Math.ceil(allRows.length / BATCH_SIZE);

      const { data: job } = await supabase.from("jobs").insert({
        type: `plugin_reimport:${p.name}`,
        status: "running",
        total_batches: totalBatches,
        metadata: { plugin_id: p.id, filename: file.name },
      }).select("id").single();
      if (!job) throw new Error("Failed to create job");

      for (let i = 0; i < totalBatches; i++) {
        const batch = allRows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        await supabase.functions.invoke("plugin-import", {
          body: { rows: batch, plugin_id: p.id, plugin_name: p.name, dataset_type: p.dataset_type, config: p.config, job_id: job.id, batch_index: i, total_batches: totalBatches },
        });
        setImportProgress(((i + 1) / totalBatches) * 100);
      }
      toast.success(`Re-imported ${allRows.length.toLocaleString()} rows into "${p.name}"`);
      load();
    } catch (err: any) {
      toast.error(`Re-import failed: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  const matchInfo = (p: Plugin) => {
    const cfg = p.config as any;
    if (cfg?.matched_companies != null) {
      return `${cfg.match_rate} matched · ${cfg.matched_companies.toLocaleString()} companies`;
    }
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground">Plugins</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Plugin
        </Button>
      </div>

      <input type="file" accept=".csv,.xlsx,.xls,.json,.jsonl" ref={fileRef} className="hidden" onChange={handleReimportFile} />

      {importing && (
        <Card>
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin" /> Importing...
            </div>
            <Progress value={importProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">{Math.round(importProgress)}%</p>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : plugins.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No plugins installed. Click "Add Plugin" to upload a dataset or fetch from MCP templates.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map((p) => {
            const match = matchInfo(p);
            return (
              <Card key={p.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <Switch checked={p.enabled} onCheckedChange={(v) => toggle(p.id, v)} />
                  </div>
                  <CardDescription>{p.description ?? "No description"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 text-xs flex-wrap">
                    {p.dataset_type && <Badge variant="secondary">{p.dataset_type}</Badge>}
                    <Badge variant="outline">{p.row_count.toLocaleString()} rows</Badge>
                    <Badge variant={p.enabled ? "default" : "secondary"}>
                      {p.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  {match && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Link2 className="h-3 w-3" /> {match}
                    </div>
                  )}
                  <div className="flex gap-1 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => openConfig(p)}>
                      <Settings className="mr-1 h-3 w-3" /> Config
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openLogs(p)}>
                      <FileText className="mr-1 h-3 w-3" /> Logs
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { (window as any).__reimportPlugin = p; fileRef.current?.click(); }}>
                      <RotateCcw className="mr-1 h-3 w-3" /> Re-import
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deletePlugin(p)}>
                      <Trash2 className="mr-1 h-3 w-3" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Plugin Dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { if (!importing) { setCreateOpen(v); if (!v) resetCreateForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Plugin</DialogTitle>
          </DialogHeader>
          <Tabs value={createTab} onValueChange={setCreateTab}>
            <TabsList className="w-full">
              <TabsTrigger value="upload" className="flex-1"><Upload className="mr-1 h-3 w-3" /> Upload File</TabsTrigger>
              <TabsTrigger value="templates" className="flex-1"><Zap className="mr-1 h-3 w-3" /> MCP Templates</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Plugin Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Industry Codes" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What does this dataset contain?" rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Dataset Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plugin">Plugin</SelectItem>
                    <SelectItem value="crm">CRM</SelectItem>
                    <SelectItem value="sector">Sector</SelectItem>
                    <SelectItem value="demographic">Demographic</SelectItem>
                    <SelectItem value="price">Price</SelectItem>
                    <SelectItem value="skattefunn">SkatteFUNN</SelectItem>
                    <SelectItem value="grants">Grants</SelectItem>
                    <SelectItem value="eu_grants">EU Grants</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Data File</Label>
                <Input type="file" accept=".csv,.xlsx,.xls,.json,.jsonl" onChange={(e) => setDataFile(e.target.files?.[0] ?? null)} />
                {dataFile && <p className="text-xs text-muted-foreground">{dataFile.name} ({(dataFile.size / 1024 / 1024).toFixed(1)} MB)</p>}
                <p className="text-xs text-muted-foreground">Supports CSV, Excel (.xlsx/.xls), JSON, JSONL</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }} disabled={importing}>Cancel</Button>
                <Button onClick={handleCreate} disabled={importing || !newName.trim() || !dataFile}>
                  {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing...</> : <><Upload className="mr-2 h-4 w-4" /> Upload & Create</>}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="templates" className="space-y-3 mt-4">
              <p className="text-sm text-muted-foreground">Auto-fetch data from public Norwegian APIs for all companies in your database.</p>
              <div className="grid gap-3">
                {MCP_TEMPLATES.map((tpl) => (
                  <Card key={tpl.id} className="cursor-pointer hover:border-primary/50 transition-colors">
                    <CardContent className="py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{tpl.icon}</span>
                        <div>
                          <p className="font-medium text-sm">{tpl.name}</p>
                          <p className="text-xs text-muted-foreground">{tpl.desc}</p>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => startMcpFetch(tpl.id)} disabled={fetchingTemplate === tpl.id}>
                        {fetchingTemplate === tpl.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Config Editor */}
      <Dialog open={!!configOpen} onOpenChange={(v) => !v && setConfigOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Configure: {configOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Configuration (JSON)</Label>
            <Textarea value={configJson} onChange={(e) => setConfigJson(e.target.value)} rows={12} className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigOpen(null)}>Cancel</Button>
            <Button onClick={saveConfig}>Save Configuration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs */}
      <Dialog open={!!logsOpen} onOpenChange={(v) => !v && setLogsOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader><DialogTitle>Logs: {logsOpen?.name}</DialogTitle></DialogHeader>
          {logsLoading ? <p className="text-sm text-muted-foreground">Loading logs...</p> : logs.length === 0 ? <p className="text-sm text-muted-foreground">No logs yet</p> : (
            <ScrollArea className="h-[50vh]">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Time</TableHead><TableHead>Action</TableHead><TableHead>Details</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{log.action}</Badge></TableCell>
                      <TableCell className="text-xs font-mono max-w-[300px] truncate">{JSON.stringify(log.details)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
