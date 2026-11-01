import { describe, expect, it } from "vitest";
import { brokerScore, cryptoScore, gearingScore, liquidityScore } from "./retailPropensity";

const base = { name: "Test ASA", last_price: null, turnover: null, retail_pct: null, short_pct: null };

describe("retail propensity", () => {
  it("liquidity is 0 at 0.1 M and 100 at 100 M turnover", () => {
    expect(liquidityScore(1e5)).toBe(0);
    expect(liquidityScore(1e8)).toBe(100);
  });
  it("penny stock with 100 M turnover and 5 % short scores 100 gearing", () => {
    expect(gearingScore({ ...base, last_price: 1, turnover: 1e8, short_pct: 5 })).toBe(100);
  });
  it("expensive illiquid stock scores 0 gearing", () => {
    expect(gearingScore({ ...base, last_price: 300, turnover: 0 })).toBe(0);
  });
  it("30 % broker share alone gives 75 broker score", () => {
    expect(brokerScore({ ...base, retail_pct: 30 })).toBe(75);
  });
  it("crypto score is 0 for non-crypto names", () => {
    expect(cryptoScore({ ...base, last_price: 1, turnover: 1e8 })).toBe(0);
    expect(cryptoScore({ ...base, name: "NBX ASA" })).toBe(60);
  });
});
