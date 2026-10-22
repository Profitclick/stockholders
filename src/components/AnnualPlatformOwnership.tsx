import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISPLAY_YEARS, annualChange, type AnnualHolding } from "@/lib/annualOwnership";
import { PLATFORM_BY_ID, PLATFORM_CATEGORIES } from "@/lib/custodyPlatforms";

const pct = (v: number | null | undefined) => v == null ? "—" : `${Number(v).toLocaleString("nb-NO", { maximumFractionDigits: 4 })} %`;
const name = (id: string) => PLATFORM_BY_ID[id]?.name ?? id;

export function AnnualPlatformOwnership({ rows, loadedYears, busy, error }: {
  rows: AnnualHolding[]; loadedYears: number[]; busy: boolean; error: string;
}) {
  const platforms = [...new Set(rows.map(r => r.platform_id))].sort((a, b) => name(a).localeCompare(name(b), "nb"));
  return <section className="space-y-5" aria-label="Årlige plattformeierandeler">
    <div><h3 className="text-base font-semibold">Eierandel per år · 2017–2025</h3>
      <p className="text-xs text-muted-foreground">— betyr ingen oppgitt plattformandel, ikke 0 %. Endring vises bare når begge årsandeler finnes.</p></div>
    {busy ? <p className="text-sm text-muted-foreground">Henter årstabeller…</p> : error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <>
      <div className="overflow-auto border rounded-md">
        <Table aria-label="Sammenligning av plattformandeler 2017–2025">
          <TableHeader><TableRow><TableHead>Plattform</TableHead>{DISPLAY_YEARS.map(year => <TableHead key={year} className="text-right whitespace-nowrap">{year}{!loadedYears.includes(year) && <span className="block text-[10px] font-normal">Ikke innlastet</span>}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{platforms.map(id => <TableRow key={id}><TableCell className="font-medium whitespace-nowrap">{name(id)}</TableCell>{DISPLAY_YEARS.map(year => <TableCell key={year} className="text-right tabular-nums whitespace-nowrap">{pct(rows.find(r => r.platform_id === id && r.year === year)?.pct)}</TableCell>)}</TableRow>)}{!platforms.length && <TableRow><TableCell colSpan={10} className="text-muted-foreground">Ingen registrerte plattformandeler for dette selskapet.</TableCell></TableRow>}</TableBody>
        </Table>
      </div>
      {DISPLAY_YEARS.map(year => {
        const loaded = loadedYears.includes(year);
        const annual = rows.filter(r => r.year === year).sort((a, b) => Number(b.pct ?? 0) - Number(a.pct ?? 0));
        return <section key={year} className="space-y-2 border-t pt-4" aria-label={`Plattformandeler ${year}`}>
          <div className="flex items-center gap-2"><h4 className="text-sm font-semibold">{year}</h4><Badge variant="outline">{loaded ? `${annual.length} plattformer` : "Ikke innlastet"}</Badge></div>
          <div className="overflow-auto"><Table aria-label={`Eierandel per plattform ${year}`}>
            <TableHeader><TableRow><TableHead>Plattform</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Eierandel</TableHead><TableHead className="text-right">Aksjer</TableHead><TableHead className="text-right">Kontoer</TableHead><TableHead className="text-right whitespace-nowrap">Endring fra {year - 1}</TableHead></TableRow></TableHeader>
            <TableBody>{annual.map(r => {
              const platform = PLATFORM_BY_ID[r.platform_id];
              const delta = annualChange(rows, r);
              return <TableRow key={r.platform_id}><TableCell className="font-medium">{name(r.platform_id)}</TableCell><TableCell className="text-xs">{platform ? PLATFORM_CATEGORIES[platform.category].short : "—"}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{pct(r.pct)}</TableCell><TableCell className="text-right tabular-nums">{r.shares?.toLocaleString("nb-NO") ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{r.accounts ?? "—"}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("nb-NO", { maximumFractionDigits: 4 })} pp`}</TableCell></TableRow>;
            })}{!annual.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">{loaded ? "Ingen registrert plattformbeholdning dette året." : `Aksjonærregisteret for ${year} er ikke innlastet. Eierandel kan ikke beregnes.`}</TableCell></TableRow>}</TableBody>
          </Table></div>
        </section>;
      })}
    </>}
  </section>;
}