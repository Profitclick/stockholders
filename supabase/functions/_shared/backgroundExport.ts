import { z } from 'npm:zod@3';

export const Filters = z.object({
  prefix: z.string().max(150).default(''), orgnr: z.string().regex(/^\d{9}$/).optional(),
  person: z.string().min(1).max(255).optional(), birthYear: z.number().int().nullable().optional(),
  trend: z.enum(['all','increased','decreased','exited','stable','new_2018','new_2019','new_2020','new_2021','new_2022','new_2023','new_2024','new_2025']).default('all'),
  minPct: z.number().min(0).max(100).default(0),
  playbook: z.enum(['historisk-majoritet','historisk-oppbygging','historisk-inngang','retail-investorer','eierskifte','generasjonsskifte','vekstkapital','fou','offentlig','lonnsom-vekst']).optional(),
  minScore: z.number().min(0).max(100).default(0), minRevenue: z.number().min(0).optional(),
  municipality: z.string().max(100).default(''), skattefunn: z.boolean().default(false),
  contract: z.boolean().default(false), contact: z.boolean().default(false),
}).strict();
export type ExportFilters = z.infer<typeof Filters>;
export const Start = z.object({ action: z.literal('start'), source: z.enum(['owners','playbook']), filters: Filters });
export const Control = z.object({ action: z.enum(['list','download','resume','cancel']), id: z.string().uuid().optional(), part: z.number().int().min(0).optional() });
export const Work = z.object({ action: z.literal('work'), id: z.string().uuid(), token: z.string().uuid() });
export const PAGE_SIZE = 1000;
export const PAGES_PER_PART = 10;

export function csvCell(value: unknown): string {
  if (value == null) return '""';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralize spreadsheet formula injection without changing numeric negatives.
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function csvRows(rows: Record<string, unknown>[], columns: string[]): string {
  return rows.map(row => columns.map(col => csvCell(row[col])).join(',')).join('\r\n');
}
export const ownerColumns = ['orgnr','company','shareholder_name','birth_year','postal',
  ...Array.from({length:9},(_,i)=>2017+i).flatMap(y=>[`pct_${y}`,`shares_${y}`]),'trend'];
export const companyColumns = ['orgnr','name','industry','nace_code','municipality','revenue','operating_profit','profit_margin','company_age_years','ceo_name','chair_name','email','phone','website','has_majority_change','has_new_shareholder','has_capital_increase','skattefunn_count','grants_count','eu_grants_count','research_council_count','contract_count','contract_value','lead_score'];
export const historicalColumns = ['owner_count','entry_count','exit_count','majority_count','increase_count','decrease_count'];
export function historical(f: ExportFilters) { return f.playbook?.startsWith('historisk-') || f.playbook === 'retail-investorer'; }

export function applyPlaybook(q: any, f: ExportFilters) {
  switch (f.playbook) {
    case 'historisk-majoritet': q=q.gt('majority_count',0); break;
    case 'historisk-oppbygging': q=q.gt('increase_count',0); break;
    case 'historisk-inngang': q=q.gt('entry_count',0); break;
    case 'retail-investorer': q=q.gte('owner_count',20).gt('entry_count',0).gt('exit_count',0); break;
    case 'eierskifte': q=q.eq('has_majority_change',true).gte('revenue',5000000); break;
    case 'generasjonsskifte': q=q.gte('company_age_years',20).gte('revenue',10000000).gte('profit_margin',5).eq('has_majority_change',false); break;
    case 'vekstkapital': q=q.or('has_capital_increase.eq.true,has_new_shareholder.eq.true').gte('revenue',1000000); break;
    case 'fou': q=q.or('skattefunn_count.gt.0,research_council_count.gt.0,eu_grants_count.gt.0,grants_count.gt.0'); break;
    case 'offentlig': q=q.gt('contract_count',0); break;
    case 'lonnsom-vekst': q=q.gte('revenue',10000000).lte('revenue',500000000).gte('profit_margin',8); break;
  }
  if(f.orgnr) q=q.eq('orgnr',f.orgnr);
  if(f.minScore>0) q=q.gte('lead_score',f.minScore);
  if(f.minRevenue!=null) q=q.gte('revenue',f.minRevenue);
  if(f.municipality.trim()) q=q.ilike('municipality',`%${f.municipality.trim()}%`);
  if(f.skattefunn) q=q.gt('skattefunn_count',0);
  if(f.contract) q=q.gt('contract_count',0);
  if(f.contact) q=q.not('ceo_name','is',null);
  return q;
}