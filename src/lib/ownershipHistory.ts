export const OWNERSHIP_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
export type OwnershipYear = typeof OWNERSHIP_YEARS[number];
export type YearColumns = { [K in OwnershipYear as `pct_${K}`]: number | null } & { [K in OwnershipYear as `shares_${K}`]: number | null };
export const YEAR_COLUMNS = OWNERSHIP_YEARS.flatMap(y => [`pct_${y}`, `shares_${y}`]).join(",");
export const EVENT_LABELS: Record<string, string> = {
  entry: "Inn i registeret", exit: "Ut av registeret", majority_gain: "Over 50 %",
  majority_loss: "Under eller lik 50 %", increase: "Økt ≥20 pp", decrease: "Redusert ≥20 pp",
};
export type OwnershipEvent = { from: number; to: number; kind: string; delta: number | null };
export type OwnershipHistory = YearColumns & {
  id: number; orgnr: string; shareholder_name: string; birth_year: number | null;
  ownership_events?: unknown;
};
// Same adjacent-register predicates as public.owner_history_events; no inferred trades or capital issues.
export function ownershipEvents(row: OwnershipHistory): OwnershipEvent[] {
  const events: OwnershipEvent[] = [];
  for (let i = 0; i < OWNERSHIP_YEARS.length - 1; i++) {
    const from = OWNERSHIP_YEARS[i], to = OWNERSHIP_YEARS[i + 1];
    const a = row[`pct_${from}`], b = row[`pct_${to}`];
    const sa = row[`shares_${from}`], sb = row[`shares_${to}`];
    const delta = a == null || b == null ? null : Number(b) - Number(a);
    const add = (kind: string) => events.push({ from, to, kind, delta });
    if (sa == null && sb != null) add("entry");
    if (sa != null && sb == null) add("exit");
    if (a != null && b != null) {
      if (a <= 50 && b > 50) add("majority_gain");
      if (a > 50 && b <= 50) add("majority_loss");
      if (delta != null && delta >= 20) add("increase");
      if (delta != null && delta <= -20) add("decrease");
    }
  }
  return events;
}