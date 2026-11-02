import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  formatMoney,
  lineTotalMinor,
  parseMoneyToMinor
} from "@rbm/shared";

describe("shared money helpers", () => {
  it("parses human amounts into tambala", () => {
    expect(parseMoneyToMinor("25,000.50")).toBe(2_500_050n);
    expect(parseMoneyToMinor("0.05")).toBe(5n);
    expect(parseMoneyToMinor("-12.345")).toBe(-1_235n);
  });

  it("rounds half away from zero", () => {
    expect(parseMoneyToMinor("1.005")).toBe(101n);
    expect(parseMoneyToMinor("-1.005")).toBe(-101n);
  });

  it("formats minor units for display", () => {
    expect(formatMoney(2_500_050n)).toBe("MWK 25,000.50");
    expect(formatMoney(-5n)).toBe("-MWK 0.05");
  });

  it("computes line totals from decimal quantities", () => {
    expect(lineTotalMinor("2.5", 1_000n)).toBe(2_500n);
    expect(lineTotalMinor("0.3333", 1_000n)).toBe(333n);
  });
});

describe("shared permissions", () => {
  it("contains unique permission keys", () => {
    const keys = PERMISSIONS.map((permission) => permission.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("sales.void");
    expect(keys).toContain("reports.export");
  });
});
