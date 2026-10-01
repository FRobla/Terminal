import { describe, expect, it } from "vitest";
import { describeFreshness, formatAge } from "./freshness";

describe("freshness", () => {
  it("formats ages compactly", () => {
    expect(formatAge(12_400)).toBe("12 s");
    expect(formatAge(257_000)).toBe("4m 17s");
    expect(formatAge(7_500_000)).toBe("2h 5m");
    expect(formatAge(-5)).toBe("0 s");
  });

  it("WO-AC-07: switches to stale after the threshold", () => {
    const retrievedAt = "2026-09-30T12:00:00.000Z";
    const base = Date.parse(retrievedAt);
    expect(describeFreshness(retrievedAt, base + 12_000, 60_000)).toEqual({
      state: "fresh",
      ageMs: 12_000,
      label: "Updated 12 s ago",
    });
    expect(describeFreshness(retrievedAt, base + 257_000, 60_000)).toEqual({
      state: "stale",
      ageMs: 257_000,
      label: "Stale — last update 4m 17s ago",
    });
  });
});
