import { describe, it, expect } from "vitest";
import { holdingPeriods, sortByFirstYear } from "./personTimeline";

const row = (shares: Record<number, number | null>, company = "A") => {
  const r: any = { orgnr: "1", company, shareholder_name: "X", birth_year: 1980, postal: null, trend: "", years_present: 0 };
  for (let y = 2017; y <= 2025; y++) { r[`shares_${y}`] = shares[y] ?? null; r[`pct_${y}`] = null; }
  return r;
};

describe("holdingPeriods", () => {
  it("splits on missing years", () => {
    expect(holdingPeriods(row({ 2017: 5, 2018: 5, 2021: 1, 2022: 1 }))).toEqual([{ from: 2017, to: 2018 }, { from: 2021, to: 2022 }]);
  });
  it("keeps tiny holdings", () => {
    expect(holdingPeriods(row({ 2025: 1 }))).toEqual([{ from: 2025, to: 2025 }]);
  });
  it("sorts by first observed year", () => {
    expect(sortByFirstYear([row({ 2020: 1 }, "B"), row({ 2018: 1 }, "C")]).map(r => r.company)).toEqual(["C", "B"]);
  });
});
