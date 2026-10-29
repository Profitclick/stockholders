import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CloudUpload, Download, Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';

export function BackgroundExportButton({source, filters, disabled=false}: {source:'owners'|'playbook'; filters:Record<string,unknown>; disabled?:boolean}) {
  const [busy,setBusy]=useState(false);
  async function start() {
    setBusy(true);
    const {error}=await supabase.functions.invoke('background-export',{body:{action:'start',source,filters}});
    setBusy(false);
    if(error) { toast.error('Kunne ikke starte eksport. Kontroller eiertilgang og prøv igjen.'); return; }
    toast.success('Bakgrunnseksport startet. Filene blir tilgjengelige i eksportarkivet.');
    window.dispatchEvent(new Event('background-export-started'));
  }
  return <Button size="sm" variant="outline" onClick={start} disabled={disabled||busy}>
    {busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<CloudUpload className="mr-2 h-4 w-4"/>} Bakgrunns-CSV · alle treff
  </Button>;
}

type Job = {id:string;source:string;status:string;row_count:number;error:string|null;lease_until:string|null;updated_at:string;parts:{path:string;rows:number;bytes:number}[]};
const statusLabels:Record<string,string>={queued:'I kø',running:'Eksporterer',completed:'Ferdig',failed:'Feilet',cancelled:'Avbrutt'};
export function BackgroundExports() {
  const [jobs,setJobs]=useState<Job[]>([]);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  async function load() {
    const {data,error}=await supabase.functions.invoke('background-export',{body:{action:'list'}});
    if(error) {setError('Kunne ikke hente bakgrunnseksporter. Krever eiertilgang.');return;}
    setError('');setJobs(data??[]);
  }
  useEffect(()=>{load();window.addEventListener('background-export-started',load);return()=>window.removeEventListener('background-export-started',load);},[]);
  const active=jobs.some(j=>j.status==='queued'||j.status==='running');
  useEffect(()=>{if(!active)return;const t=setInterval(load,10000);return()=>clearInterval(t);},[active]);
  async function action(job:Job,action:'download'|'resume'|'cancel',part?:number) {
    setBusy(job.id);
    const {data,error}=await supabase.functions.invoke('background-export',{body:{action,id:job.id,part}});
    setBusy(null);
    if(error){toast.error('Handlingen kunne ikke utføres. Prøv igjen.');return;}
    if(action==='download'&&data?.url) {const a=document.createElement('a');a.href=data.url;a.rel='noreferrer';a.click();}
    else await load();
  }
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Bakgrunnseksporter</h2><Button variant="ghost" size="sm" onClick={load}><RotateCcw className="mr-2 h-4 w-4"/>Oppdater</Button></div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!error&&!jobs.length&&<p className="text-sm text-muted-foreground">Ingen bakgrunnseksporter ennå.</p>}
    {jobs.map(job=>{
      const stalled=(job.status==='running'&&job.lease_until&&new Date(job.lease_until).getTime()<Date.now())||(job.status==='queued'&&Date.now()-new Date(job.updated_at).getTime()>180000);
      return <div key={job.id} className="border-b border-border py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{job.source==='owners'?'Personeiere':'Playbook'}</span><Badge variant="secondary">{stalled?'Venter på gjenopptakelse':statusLabels[job.status]}</Badge><span className="text-sm tabular-nums">{job.row_count.toLocaleString('nb-NO')} rader · {job.parts.length} filer</span></div>
        {job.error&&<p role="alert" className="text-sm text-destructive">{job.error}</p>}
        <div className="flex flex-wrap gap-2">
          {job.status==='completed'&&job.parts.map((part,index)=><Button key={part.path} variant="outline" size="sm" disabled={busy===job.id} onClick={()=>action(job,'download',index)}><Download className="mr-2 h-4 w-4"/>CSV {index+1} · {part.rows.toLocaleString('nb-NO')} rader</Button>)}
          {(job.status==='failed'||stalled)&&<Button variant="outline" size="sm" disabled={busy===job.id} onClick={()=>action(job,'resume')}><RotateCcw className="mr-2 h-4 w-4"/>Gjenoppta</Button>}
          {['queued','running','failed'].includes(job.status)&&<Button variant="ghost" size="sm" disabled={busy===job.id} onClick={()=>action(job,'cancel')}><X className="mr-2 h-4 w-4"/>Avbryt</Button>}
        </div>
      </div>;
    })}
  </section>;
}