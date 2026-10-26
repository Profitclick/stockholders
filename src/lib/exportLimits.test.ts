import { describe, expect, it } from "vitest";
import { collectExportPages, exportLimit, MAX_EXPORT_ROWS } from "./exportLimits";

describe("Export row limits", () => {
  it("allows exactly 500000 rows and clamps larger requests", () => {
    expect(MAX_EXPORT_ROWS).toBe(500000);
    expect(exportLimit(500000)).toBe(500000);
    expect(exportLimit(500001)).toBe(500000);
  });
  it("exports 500000 rows in bounded pages beyond the API's 1000-row cap", async () => {
    let consumed = 0;
    let requests = 0;
    const count = await collectExportPages(async (offset, size) => {
      expect(offset).toBe(consumed);
      expect(size).toBeLessThanOrEqual(1000);
      requests++;
      return Array.from({ length: size }, (_, i) => offset + i);
    }, (rows, first) => {
      expect(first).toBe(consumed === 0);
      consumed += rows.length;
    });
    expect(count).toBe(500000);
    expect(consumed).toBe(500000);
    expect(requests).toBe(500);
  });
  it("stops when the filtered selection is exhausted", async () => {
    const count = await collectExportPages(async (offset) => offset === 0 ? Array(1000).fill(1) : Array(7).fill(1), () => {});
    expect(count).toBe(1007);
  });
  it("fails instead of completing a partial export after a query error", async () => {
    await expect(collectExportPages(async (offset) => {
      if (offset > 0) throw new Error("network");
      return Array(1000).fill(1);
    }, () => {})).rejects.toThrow("network");
  });
});