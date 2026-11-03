import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OWNERSHIP_YEARS, YEAR_COLUMNS } from "@/lib/ownershipHistory";
import type { PersonAnnualRow } from "@/lib/personAnnualOwnership";
import { holdingPeriods, sortByFirstYear } from "@/lib/personTimeline";

const COLS = `orgnr,company,shareholder_name,birth_year,postal,trend,years_present,max_pct,${YEAR_COLUMNS}`;
type Owner = PersonAnnualRow & { max_pct: number | null };
const pct = (v: unknown) => (v == null ? "" : `${Number(v).toLocaleString("nb-NO", { maximumFractionDigits: 2 })} %`);

/** Named direct owners of one company; click a person to see every company they have owned 2017–2025. */
export function PersonOwnerTimeline({ orgnr }: { orgnr: string }) {
  const [owners, setOwners] = useState<Owner[] | null>(null);
  const [person, setPerson] = useState<Owner | null>(null);
  const [portfolio, setPortfolio] = useState<PersonAnnualRow[] | null>(null);

  useEffect(() => {
    setOwners(null); setPerson(null);
    supabase.from("person_ownership_history").select(COLS).eq("orgnr", orgnr)
      .order("max_pct", { ascending: false, nullsFirst: false }).limit(15)
      .then(({ data }) => setOwners((data as unknown as Owner[]) ?? []));
  }, [orgnr]);

  useEffect(() => {
    if (!person) return;
    setPortfolio(null);
    let q = supabase.from("person_ownership_history").select(COLS).eq("shareholder_name", person.shareholder_name);
    q = person.birth_year == null ? q.is("birth_year", null) : q.eq("birth_year", person.birth_year);
    q.limit(200).then(({ data }) => setPortfolio(sortByFirstYear((data as unknown as PersonAnnualRow[]) ?? [])));
  }, [person]);

  if (!owners) return <Loader2 className="h-4 w-4 animate-spin" />;
  if (!owners.length) return <p className="text-sm text-muted-foreground">Ingen navngitte personeiere (eller mangler admintilgang).</p>;

  if (!person) return (
    <div className="space-y-0.5">
      {owners.map(o => (
        <button key={`${o.shareholder_name}-${o.birth_year}`} onClick={() => setPerson(o)}
          className="w-full flex justify-between gap-2 py-1 text-sm text-left border-b border-border/50 hover:bg-muted/50 rounded px-1">
          <span className="truncate">{o.shareholder_name} <span className="text-muted-foreground">{o.birth_year ?? ""}</span></span>
          <span className="font-mono text-muted-foreground shrink-0">maks {pct(o.max_pct)}</span>
        </button>
      ))}
      <p className="text-[11px] text-muted-foreground pt-1">Klikk en person for å se alle selskaper vedkommende har eid over tid.</p>
    </div>
  );

  return (
    <div className="space-y-2">
      <Button variant="ghost" size="sm" className="h-7 px-1" onClick={() => setPerson(null)}><ChevronLeft className="h-4 w-4" /> Alle eiere</Button>
      <p className="text-sm font-medium">{person.shareholder_name} <span className="text-muted-foreground">f. {person.birth_year ?? "—"} · {person.postal ?? ""}</span></p>
      {!portfolio ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-muted-foreground">
              <th className="text-left font-normal pr-2">Selskap</th>
              {OWNERSHIP_YEARS.map(y => <th key={y} className="font-normal px-0.5">{String(y).slice(2)}</th>)}
              <th className="text-right font-normal pl-2">Periode</th>
            </tr></thead>
            <tbody>
              {portfolio.map(r => (
                <tr key={r.orgnr} className={r.orgnr === orgnr ? "font-semibold" : ""}>
                  <td className="pr-2 py-0.5 max-w-[9rem] truncate" title={r.company ?? r.orgnr}>{r.company ?? r.orgnr}</td>
                  {OWNERSHIP_YEARS.map(y => {
                    const held = r[`shares_${y}`] != null;
                    return <td key={y} className="px-0.5"><div title={held ? `${y}: ${pct(r[`pct_${y}`])}` : `${y}: ikke registrert`}
                      className={`h-3 rounded-sm ${held ? "bg-primary" : "bg-muted"}`} /></td>;
                  })}
                  <td className="pl-2 text-right font-mono whitespace-nowrap text-muted-foreground">
                    {holdingPeriods(r).map(p => p.from === p.to ? p.from : `${p.from}–${String(p.to).slice(2)}`).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground pt-1">{portfolio.length} selskaper. Matchet på navn + fødselsår i Aksjonærregisteret; perioder er registrerte år, ikke dokumenterte kjøp/salg.</p>
        </div>
      )}
    </div>
  );
}
