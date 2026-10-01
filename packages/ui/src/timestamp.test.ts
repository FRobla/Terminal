import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./timestamp";

describe("formatTimestamp", () => {
  it("SET-AC-06: renders UTC with its label", () => {
    expect(formatTimestamp("2026-10-01T09:05:07.123Z", "utc")).toBe("2026-10-01 09:05:07 UTC");
  });

  it("SET-AC-06: renders the local zone with a zone label", () => {
    expect(formatTimestamp("2026-10-01T09:05:07.123Z", "local")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+/,
    );
  });

  it("never renders an invalid date as a time", () => {
    expect(formatTimestamp("not a date", "utc")).toBe("Invalid time");
  });
});
