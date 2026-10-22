import { describe, expect, it } from "vitest";
import { annualChange, DISPLAY_YEARS, type AnnualHolding } from "./annualOwnership";
const row: AnnualHolding = { orgnr: "923609016", year: 2025, platform_id: "nordnet", pct: 12, shares: 100, accounts: 1 };
describe("Annual ownership comparisons", () => {
  it("covers each requested year from 2017 to 2025", () => {
    expect(DISPLAY_YEARS).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  });
  it("compares the same company and platform in the preceding year", () => {
    expect(annualChange([row, { ...row, year: 2024, pct: 9 }], row)).toBe(3);
  });
  it("does not assume missing history is zero", () => {
    expect(annualChange([row, { ...row, year: 2023, pct: 9 }], row)).toBeNull();
    expect(annualChange([row, { ...row, year: 2024, pct: null }], row)).toBeNull();
  });
  it("does not compare different companies or platforms", () => {
    expect(annualChange([{ ...row, year: 2024, orgnr: "111111111" }, { ...row, year: 2024, platform_id: "other" }], row)).toBeNull();
  });
});