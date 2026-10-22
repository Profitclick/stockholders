export const DISPLAY_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] as const;
export type AnnualHolding = { year: number; orgnr: string; platform_id: string; pct: number | null; shares: number | null; accounts: number | null };

// Compare observed values only: an absent register row is not evidence of zero ownership.
export function annualChange(rows: AnnualHolding[], holding: AnnualHolding): number | null {
  const previous = rows.find(r => r.year === holding.year - 1 && r.orgnr === holding.orgnr && r.platform_id === holding.platform_id);
  return previous?.pct == null || holding.pct == null ? null : Number(holding.pct) - Number(previous.pct);
}