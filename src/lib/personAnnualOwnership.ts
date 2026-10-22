import { DISPLAY_YEARS } from "./annualOwnership";
import { OWNERSHIP_YEARS } from "./ownershipHistory";

export type PersonAnnualRow = {
  orgnr: string; company: string | null; shareholder_name: string; birth_year: number | null;
  postal: string | null; pct_2022: number | null; pct_2023: number | null;
  pct_2024: number | null; pct_2025: number | null;
  shares_2022: number | null; shares_2023: number | null;
  shares_2024: number | null; shares_2025: number | null;
  trend: string; years_present: number;
};

export function personYearValue(row: PersonAnnualRow, year: number, field: "pct" | "shares" = "pct"): number | null {
  const loaded = OWNERSHIP_YEARS.find(y => y === year);
  return loaded == null ? null : row[`${field}_${loaded}`];
}

export function personYearChange(row: PersonAnnualRow, year: number): number | null {
  const current = personYearValue(row, year);
  const previous = personYearValue(row, year - 1);
  return current == null || previous == null ? null : Number(current) - Number(previous);
}

export function personAnnualRows(rows: PersonAnnualRow[], year: number): PersonAnnualRow[] {
  if (!DISPLAY_YEARS.some(y => y === year)) return [];
  return rows.filter(row => personYearValue(row, year, "shares") != null);
}