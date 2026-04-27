import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Edit2, Trash2, Play, Loader2, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { useNavigate } from "react-router-dom";

interface Profile {
  id: string;
  name: string;
  description: string | null;
  rules: any;
  weights: any;
  thresholds: any;
  is_prebuilt: boolean;
}

const DEFAULT_WEIGHTS = {
  portfolio_size: 30,
  yoy_changes: 25,
  entity_type: 20,
  industry_exposure: 15,
  capital_estimate: 10,
  risk: 0,
  sector: 0,
  capital: 0,
  velocity: 0,
};

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [rulesText, setRulesText] = useState("{}");
  const [thresholdScore, setThresholdScore] = useState(50);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("profiles").select("*").order("is_prebuilt", { ascending: false }).order("name");
    setProfiles((data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    const timer = setTimeout(async () => {
      const { count } = await supabase.from("investors").select("id", { count: "exact", head: true }).gte("ias_score", thresholdScore);
      setLiveCount(count ?? 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [thresholdScore]);

  function openEdit(p: Profile) {
    setEditing(p);
    setName(p.name);
    setDescription(p.description ?? "");
    setWeights({ ...DEFAULT_WEIGHTS, ...(p.weights as any ?? {}) });
    setRulesText(JSON.stringify(p.rules, null, 2));
    setThresholdScore((p.thresholds as any)?.min_score ?? 50);
  }

  function openCreate() {
    setShowCreate(true);
    setName("");
    setDescription("");
    setWeights(DEFAULT_WEIGHTS);
    setRulesText("{}");
    setThresholdScore(50);
  }

  async function save() {
    let rules: any;
    try { rules = JSON.parse(rulesText); } catch { toast({ title: "Invalid JSON in rules", variant: "destructive" }); return; }
    const payload = { name, description, rules, weights, thresholds: { min_score: thresholdScore } };
    if (editing) {
      await supabase.from("profiles").update(payload).eq("id", editing.id);
      toast({ title: "Profile updated" });
    } else {
      await supabase.from("profiles").insert(payload);
      toast({ title: "Profile created" });
    }
    setEditing(null);
    setShowCreate(false);
    load();
  }

  async function remove(id: string) {
    await supabase.from("profiles").delete().eq("id", id);
    toast({ title: "Profile deleted" });
    load();
  }

  async function runScoring() {
    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke("ias-scoring", { body: {} });
      if (error) throw error;
      sonnerToast.success(`Scored ${data?.scored ?? 0} investors (IAS + Risk + Sector + Capital + Velocity)`);
    } catch (err: any) {
      sonnerToast.error(`Scoring failed: ${err.message}`);
    } finally {
      setScoring(false);
    }
  }

  async function generateSegment(profileId: string) {
    setGenerating(profileId);
    try {
      const { data, error } = await supabase.functions.invoke("generate-segment", { body: { profile_id: profileId } });
      if (error) throw error;
      sonnerToast.success(`Segment created with ${data?.summary?.total_investors ?? 0} investors`);
      navigate("/segments");
    } catch (err: any) {
      sonnerToast.error(`Segment generation failed: ${err.message}`);
    } finally {
      setGenerating(null);
    }
  }

  const isOpen = !!editing || showCreate;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Investor Profiles</h1>
        <div className="flex gap-2">
          <Button onClick={runScoring} disabled={scoring} variant="outline" size="sm">
            {scoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BarChart3 className="mr-2 h-4 w-4" />}
            Run Multi-Scoring
          </Button>
          <Button onClick={openCreate} size="sm"><Plus className="mr-2 h-4 w-4" /> New Profile</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription className="mt-1">{p.description ?? "No description"}</CardDescription>
                  </div>
                  {p.is_prebuilt && <Badge>Prebuilt</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground space-y-1 mb-3">
                  <p>Min score: {(p.thresholds as any)?.min_score ?? "—"}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(p)}><Edit2 className="mr-1 h-3 w-3" /> Edit</Button>
                  <Button variant="default" size="sm" onClick={() => generateSegment(p.id)} disabled={generating === p.id}>
                    {generating === p.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                    Generate
                  </Button>
                  {!p.is_prebuilt && (
                    <Button variant="ghost" size="sm" onClick={() => remove(p.id)}><Trash2 className="mr-1 h-3 w-3" /> Delete</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={() => { setEditing(null); setShowCreate(false); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Profile" : "New Profile"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <Label>Minimum IAS Score Threshold</Label>
              <div className="flex items-center gap-3">
                <Slider value={[thresholdScore]} onValueChange={([v]) => setThresholdScore(v)} min={0} max={100} step={1} className="flex-1" />
                <span className="text-sm font-mono w-8">{thresholdScore}</span>
              </div>
              {liveCount !== null && (
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">{liveCount.toLocaleString()}</span> investors match
                </p>
              )}
            </div>
            <div className="space-y-3">
              <Label>Scoring Weights</Label>
              {Object.entries(weights).map(([key, val]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-sm w-36 text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                  <Slider value={[val as number]} onValueChange={([v]) => setWeights({ ...weights, [key]: v })} min={0} max={100} step={5} className="flex-1" />
                  <span className="text-sm font-mono w-8">{val}</span>
                </div>
              ))}
            </div>
            <div>
              <Label>Rules (JSON)</Label>
              <Textarea value={rulesText} onChange={(e) => setRulesText(e.target.value)} rows={5} className="font-mono text-xs" placeholder='{"entity_types": ["AS", "ASA"], "min_portfolio_size": 5}' />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={save}>{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
