import { describe, expect, it } from "vitest";
import { formatRawAmount } from "./amounts";

describe("formatRawAmount", () => {
  it("WO-AC-03: converts lamports to SOL exactly without floating-point rounding", () => {
    expect(formatRawAmount(1_500_000_000n, 9)).toBe("1.5");
    expect(formatRawAmount(1n, 9)).toBe("0.000000001");
    expect(formatRawAmount(0n, 9)).toBe("0");
    expect(formatRawAmount(123_456_789_012_345_678_901n, 9)).toBe("123456789012.345678901");
  });

  it("handles zero decimals and large decimal counts", () => {
    expect(formatRawAmount(42n, 0)).toBe("42");
    expect(formatRawAmount(10n ** 20n, 20)).toBe("1");
  });

  it("rejects negative amounts and invalid decimals", () => {
    expect(() => formatRawAmount(-1n, 9)).toThrow(RangeError);
    expect(() => formatRawAmount(1n, -1)).toThrow(RangeError);
    expect(() => formatRawAmount(1n, 1.5)).toThrow(RangeError);
  });
});
