import { describe, it, expect, vi } from 'vitest';
vi.mock('npm:zod@3', async()=>await import('zod'));
import { Filters, Work, csvCell, csvRows, ownerColumns, applyPlaybook } from '../../supabase/functions/_shared/backgroundExport';

describe('Background export',()=>{
  it('preserves missing holdings as empty rather than zero',()=>{
    expect(csvRows([{pct_2017:null,pct_2018:0}],['pct_2017','pct_2018'])).toBe('"","0"');
  });
  it('includes every register year 2017–2025',()=>{
    expect(ownerColumns.filter(c=>c.startsWith('pct_'))).toEqual(Array.from({length:9},(_,i)=>`pct_${2017+i}`));
  });
  it('rejects client-supplied roles and arbitrary filters',()=>{
    expect(Filters.safeParse({role:'admin'}).success).toBe(false);
  });
  it('requires an unguessable job capability',()=>{
    expect(Work.safeParse({action:'work',id:'e4f177ad-5f0f-4ba0-b08c-19e2a05baf00'}).success).toBe(false);
  });
  it('escapes multiline quotes and neutralizes formulas',()=>{
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
    expect(csvCell(-20)).toBe('"-20"');
  });
  it('retains retail criteria and user filters',()=>{
    const q:any={}; for(const m of ['gte','gt','eq','ilike','not']) q[m]=vi.fn(()=>q);
    applyPlaybook(q,Filters.parse({playbook:'retail-investorer',minScore:40,municipality:'Bergen'}));
    expect(q.gte).toHaveBeenCalledWith('owner_count',20);
    expect(q.gt).toHaveBeenCalledWith('entry_count',0);
    expect(q.gt).toHaveBeenCalledWith('exit_count',0);
    expect(q.gte).toHaveBeenCalledWith('lead_score',40);
    expect(q.ilike).toHaveBeenCalledWith('municipality','%Bergen%');
  });
});