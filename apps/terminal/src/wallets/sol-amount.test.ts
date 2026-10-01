import { describe, expect, it } from "vitest";
import { formatSol, parseSolToLamports } from "./sol-amount";

describe("SOL amounts", () => {
  it("WRG-AC-15: formats lamports exactly, with sign and grouping", () => {
    expect(formatSol("0")).toBe("0.000000000");
    expect(formatSol("2500000000")).toBe("2.500000000");
    expect(formatSol("-1005000")).toBe("-0.001005000");
    expect(formatSol("1234567000000001")).toBe("1,234,567.000000001");
  });

  it("TXL-AC-03: parses typed SOL into lamports without floating point", () => {
    expect(parseSolToLamports("1")).toBe(1_000_000_000n);
    expect(parseSolToLamports("0.000000001")).toBe(1n);
    expect(parseSolToLamports(" 2.5 ")).toBe(2_500_000_000n);
    expect(parseSolToLamports("0.0000000001")).toBeNull();
    expect(parseSolToLamports("-1")).toBeNull();
    expect(parseSolToLamports("1e3")).toBeNull();
  });
});
