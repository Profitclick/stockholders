import { OWNERSHIP_YEARS } from "./ownershipHistory";
import type { PersonAnnualRow } from "./personAnnualOwnership";

export type HoldingPeriod = { from: number; to: number };

/** Contiguous loaded years where the person had observed shares; gaps split periods, nothing is inferred. */
export function holdingPeriods(row: PersonAnnualRow): HoldingPeriod[] {
  const out: HoldingPeriod[] = [];
  let cur: HoldingPeriod | null = null;
  for (const y of OWNERSHIP_YEARS) {
    if (row[`shares_${y}`] != null) {
      if (cur) cur.to = y; else { cur = { from: y, to: y }; out.push(cur); }
    } else cur = null;
  }
  return out;
}

/** Companies ordered by first observed year, then name. */
export function sortByFirstYear(rows: PersonAnnualRow[]): PersonAnnualRow[] {
  const first = (r: PersonAnnualRow) => holdingPeriods(r)[0]?.from ?? 9999;
  return [...rows].sort((a, b) => first(a) - first(b) || (a.company ?? "").localeCompare(b.company ?? ""));
}
