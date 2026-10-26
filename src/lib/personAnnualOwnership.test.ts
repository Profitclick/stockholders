import { describe, expect, it } from "vitest";
import { personAnnualRows, personYearChange, personYearValue, type PersonAnnualRow } from "./personAnnualOwnership";

const row: PersonAnnualRow = {
  orgnr: "923609016", company: "Test AS", shareholder_name: "Test", birth_year: 1980, postal: null,
  pct_2017: 5, pct_2018: null, pct_2019: null, pct_2020: null, pct_2021: null,
  shares_2017: 50, shares_2018: null, shares_2019: null, shares_2020: null, shares_2021: null,
  pct_2022: null, pct_2023: 0, pct_2024: 0.001, pct_2025: 20,
  shares_2022: null, shares_2023: 1, shares_2024: 2, shares_2025: 100,
  trend: "increased", years_present: 3,
};

describe("Person annual portfolios", () => {
  it("reads loaded 2017 values and leaves absent 2018–2021 holdings empty", () => {
    expect(personYearValue(row, 2017)).toBe(5);
    expect(personAnnualRows([row], 2017)).toEqual([row]);
    for (const year of [2018, 2019, 2020, 2021]) expect(personAnnualRows([row], year)).toEqual([]);
    expect(personYearChange(row, 2018)).toBeNull();
  });
  it("includes all observed holdings including rounded zero and tiny percentages", () => {
    expect(personAnnualRows([row], 2023)).toEqual([row]);
    expect(personAnnualRows([row], 2024)).toEqual([row]);
    expect(personYearValue(row, 2023)).toBe(0);
    expect(personYearValue(row, 2024)).toBe(0.001);
  });
  it("compares consecutive observed percentages in percentage points", () => {
    expect(personYearChange(row, 2024)).toBe(0.001);
    expect(personYearChange(row, 2025)).toBe(19.999);
  });
  it("does not treat missing history as zero", () => {
    expect(personYearChange(row, 2023)).toBeNull();
    expect(personAnnualRows([row], 2022)).toEqual([]);
  });
});