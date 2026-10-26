import { describe, expect, it } from "vitest";
import { ownershipEvents, type OwnershipHistory } from "./ownershipHistory";
const row: OwnershipHistory = { id: 1, orgnr: "923609016", shareholder_name: "Test", birth_year: 1980,
  pct_2017: null, pct_2018: null, pct_2019: null, pct_2020: null, pct_2021: null,
  shares_2017: null, shares_2018: null, shares_2019: null, shares_2020: null, shares_2021: null,
  pct_2022: 10, pct_2023: 31, pct_2024: 60, pct_2025: 40,
  shares_2022: 10, shares_2023: 31, shares_2024: 60, shares_2025: 40 };
describe("Full 2017–2025 register history", () => {
  it("detects movements in the 2017–2021 years", () => {
    const e = ownershipEvents({ ...row, pct_2017: 10, shares_2017: 10, pct_2018: 55, shares_2018: 55 });
    expect(e.filter(x => x.from === 2017).map(x => x.kind).sort()).toEqual(["increase", "majority_gain"]);
    expect(e.find(x => x.from === 2018)).toMatchObject({ kind: "exit", to: 2019 });
  });
  it("includes movements in all three periods, not just 2025", () => {
    expect(ownershipEvents(row).filter(e => e.kind === "increase").map(e => e.from)).toEqual([2022, 2023]);
    expect(ownershipEvents(row).filter(e => e.kind === "decrease").map(e => e.from)).toEqual([2024]);
  });
  it("includes tiny holdings without any ownership threshold", () => {
    expect(ownershipEvents({ ...row, pct_2022: null, shares_2022: null, pct_2023: 0.001, shares_2023: 1 })[0]).toMatchObject({ kind: "entry", from: 2022, to: 2023 });
  });
  it("does not turn missing percentages into zero or majority acquisition", () => {
    const events = ownershipEvents({ ...row, pct_2022: null, shares_2022: null, pct_2023: 60, pct_2024: 60, pct_2025: 60 });
    expect(events).toEqual([{ from: 2022, to: 2023, kind: "entry", delta: null }]);
  });
  it("requires crossing strictly above 50 percent for majority gain", () => {
    expect(ownershipEvents({ ...row, pct_2022: 49, pct_2023: 50, pct_2024: 51, pct_2025: 50 }).filter(e => e.kind.startsWith("majority"))).toEqual([
      { from: 2023, to: 2024, kind: "majority_gain", delta: 1 }, { from: 2024, to: 2025, kind: "majority_loss", delta: -1 },
    ]);
  });
  it("share-count growth alone is not a capital increase signal", () => {
    expect(ownershipEvents({ ...row, pct_2022: 10, pct_2023: 10, pct_2024: 10, pct_2025: 10, shares_2025: 1000 })).toEqual([]);
  });
  it("records exits without claiming a sale", () => {
    expect(ownershipEvents({ ...row, pct_2022: 10, pct_2023: 10, pct_2024: 10, pct_2025: null, shares_2025: null })).toEqual([{ from: 2024, to: 2025, kind: "exit", delta: null }]);
  });
});