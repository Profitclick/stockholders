import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DISPLAY_YEARS } from "@/lib/annualOwnership";
import { OWNERSHIP_YEARS } from "@/lib/ownershipHistory";
import { personAnnualRows, personYearChange, personYearValue, type PersonAnnualRow } from "@/lib/personAnnualOwnership";

export const formatPersonPct = (value: number | null) => value == null ? "—" : `${Number(value).toLocaleString("nb-NO", { maximumFractionDigits: 6 })} %`;

export function PersonAnnualPortfolio({ rows }: { rows: PersonAnnualRow[] }) {
  return <div className="space-y-5">
    {DISPLAY_YEARS.map(year => {
      const loaded = OWNERSHIP_YEARS.some(y => y === year);
      const annual = personAnnualRows(rows, year);
      return <section key={year} aria-label={`Eierportefølje ${year}`} className="space-y-2 border-t pt-4">
        <div className="flex items-center gap-2"><h2 className="text-base font-semibold">{year}</h2><Badge variant="outline">{loaded ? `${annual.length} selskaper i utvalget` : "Ikke innlastet"}</Badge></div>
        <div className="overflow-x-auto"><Table aria-label={`Personens eierandeler ${year}`}>
          <TableHeader><TableRow><TableHead>Selskap</TableHead><TableHead>Org.nr.</TableHead><TableHead className="text-right">Eierandel</TableHead><TableHead className="text-right">Aksjer</TableHead><TableHead className="text-right whitespace-nowrap">Endring fra {year - 1}</TableHead></TableRow></TableHeader>
          <TableBody>{annual.map(row => {
            const delta = personYearChange(row, year);
            return <TableRow key={row.orgnr}><TableCell className="font-medium">{row.company ?? "—"}</TableCell><TableCell className="font-mono">{row.orgnr}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{formatPersonPct(personYearValue(row, year))}</TableCell><TableCell className="text-right tabular-nums">{personYearValue(row, year, "shares")?.toLocaleString("nb-NO") ?? "—"}</TableCell><TableCell className="text-right tabular-nums whitespace-nowrap">{delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("nb-NO", { maximumFractionDigits: 6 })} pp`}</TableCell></TableRow>;
          })}{!annual.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">{loaded ? "Ingen registrert beholdning i dette utvalget dette året." : `Aksjonærregisteret for ${year} er ikke innlastet. Eierandel kan ikke beregnes.`}</TableCell></TableRow>}</TableBody>
        </Table></div>
      </section>;
    })}
  </div>;
}