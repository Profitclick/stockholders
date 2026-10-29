import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { requireAdmin } from '../_shared/requireAdmin.ts';
import { Start, Control, Work, Filters, PAGE_SIZE, PAGES_PER_PART, csvCell, csvRows, ownerColumns, companyColumns, historicalColumns, historical, applyPlaybook } from '../_shared/backgroundExport.ts';

const safeColumns='id,source,filters,status,row_count,parts,error,created_at,updated_at,lease_until';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return response({error:'POST required'},405);
  let body:unknown;
  try { body=await req.json(); } catch { return response({error:'Invalid JSON'},400); }
  const work=Work.safeParse(body);
  // A worker capability is random, private, scoped to a single queued job, and never returned to clients.
  if(!work.success) { const denied=await requireAdmin(req,corsHeaders); if(denied) return denied; }
  const url=Deno.env.get('SUPABASE_URL'); const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url || !key) return response({error:'Export unavailable'},500);
  const db=createClient(url,key);
  if(work.success) {
    const {data:claimed,error:claimError}=await db.rpc('claim_background_export',{p_id:work.data.id,p_token:work.data.token});
    if(claimError) return response({error:'Cannot claim export'},500);
    const job=claimed?.[0];
    if(!job) return response({error:'Unauthorized or already claimed'},403);
    try {
      const {data:allowed,error:roleError}=await db.rpc('has_role',{_user_id:job.created_by,_role:'admin'});
      if(roleError || !allowed) throw new Error('Administrator access revoked');
      const f=Filters.parse(job.filters);
      const cols=job.source==='owners'?ownerColumns:[...companyColumns,...(historical(f)?historicalColumns:[])];
      let cursor=job.cursor; let count=0; let done=false;
      const blocks=['\uFEFF'+cols.map(csvCell).join(',')];
      for(let i=0;i<PAGES_PER_PART;i++) {
        let query;
        if(job.source==='owners') {
          query=db.from('person_ownership_history').select(['id',...cols].join(',')).gt('id',cursor.id??0).order('id').limit(PAGE_SIZE);
          if(f.person) { query=query.eq('shareholder_name',f.person); query=f.birthYear==null?query.is('birth_year',null):query.eq('birth_year',f.birthYear); }
          else {
            if(f.orgnr) query=query.eq('orgnr',f.orgnr);
            else if(f.prefix.trim()) {
              const p=f.prefix.trim().toUpperCase().replace(/[%_\\,().]/g,'');
              if(p.length<2) throw new Error('Søk må ha minst to tegn');
              query=query.or(`shareholder_name.like.${p}%,company.like.${p}%`);
            }
            if(f.trend!=='all') query=query.eq('trend',f.trend);
            if(f.minPct>0) query=query.gte('max_pct',f.minPct);
          }
        } else {
          query=applyPlaybook(db.from(historical(f)?'historical_playbook_candidates':'company_signals').select(cols.join(',')),f).order('orgnr').limit(PAGE_SIZE);
          if(cursor.orgnr) query=query.gt('orgnr',cursor.orgnr);
        }
        const {data,error}=await query;
        if(error) throw new Error('Kunne ikke hente eksportpuljen');
        const rows=(data??[]) as unknown as Record<string,unknown>[];
        if(rows.length) {
          blocks.push(csvRows(rows,cols)); count+=rows.length;
          const last=rows[rows.length-1];
          cursor=job.source==='owners'?{id:last.id}:{orgnr:last.orgnr};
        }
        if(rows.length<PAGE_SIZE) {done=true;break;}
      }
      const parts=[...job.parts];
      if(count>0) {
        const path=`${job.id}/part-${String(parts.length+1).padStart(5,'0')}.csv`;
        const blob=new Blob([blocks.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
        const {error}=await db.storage.from('export-files').upload(path,blob,{upsert:true,contentType:'text/csv;charset=utf-8'});
        if(error) throw new Error('Kunne ikke lagre eksportfilen');
        parts.push({path,rows:count,bytes:blob.size});
      }
      const {error}=await db.from('background_exports').update({status:done?'completed':'queued',cursor,parts,row_count:job.row_count+count,lease_until:null,error:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('worker_token',work.data.token).eq('status','running');
      if(error) throw new Error('Kunne ikke lagre fremdrift');
      return response({ok:true});
    } catch(e) {
      await db.from('background_exports').update({status:'failed',error:e instanceof Error?e.message:'Export failed',lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('worker_token',work.data.token).eq('status','running');
      return response({error:'Export failed; saved parts can be resumed'},500);
    }
  }
  const start=Start.safeParse(body);
  if(start.success) {
    if(start.data.source==='playbook'&&!start.data.filters.playbook) return response({error:'Velg playbook'},400);
    const auth=req.headers.get('Authorization')??'';
    const {data:user}=await db.auth.getUser(auth.slice(7));
    if(!user.user) return response({error:'Ikke innlogget'},401);
    const {count,error:countError}=await db.from('background_exports').select('id',{count:'exact',head:true}).in('status',['queued','running']);
    if(countError) return response({error:'Cannot check queue'},500);
    if((count??0)>=2) return response({error:'To eksporter kjører allerede. Vent til en er ferdig.'},409);
    const {data,error}=await db.from('background_exports').insert({created_by:user.user.id,source:start.data.source,filters:start.data.filters}).select(safeColumns).single();
    return error?response({error:'Kunne ikke starte eksport'},500):response(data,202);
  }
  const control=Control.safeParse(body);
  if(!control.success) return response({error:'Ugyldig eksportforespørsel'},400);
  const c=control.data;
  if(c.action==='list') {
    const {data,error}=await db.from('background_exports').select(safeColumns).order('created_at',{ascending:false}).limit(50);
    return error?response({error:'Kunne ikke hente eksporter'},500):response(data);
  }
  if(!c.id) return response({error:'id required'},400);
  const {data:job,error}=await db.from('background_exports').select('*').eq('id',c.id).single();
  if(error||!job) return response({error:'Export not found'},404);
  if(c.action==='download') {
    if(job.status!=='completed') return response({error:'Eksporten er ikke ferdig'},409);
    const part=job.parts[c.part??0];
    if(!part) return response({error:'File not found'},404);
    const {data,error}=await db.storage.from('export-files').createSignedUrl(part.path,300,{download:true});
    return error?response({error:'Download unavailable'},500):response({url:data.signedUrl});
  }
  if(c.action==='resume') {
    if(job.status==='completed'||job.status==='cancelled'||(job.status==='running'&&new Date(job.lease_until)>new Date())) return response({error:'Eksporten kan ikke gjenopptas ennå'},409);
    const {error}=await db.from('background_exports').update({status:'queued',worker_token:crypto.randomUUID(),error:null,lease_until:null,updated_at:new Date().toISOString()}).eq('id',job.id).eq('updated_at',job.updated_at);
    return error?response({error:'Resume failed'},500):response({ok:true});
  }
  const {error:cancelError}=await db.from('background_exports').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',job.id).in('status',['queued','running','failed']);
  return cancelError?response({error:'Cancel failed'},500):response({ok:true});
});