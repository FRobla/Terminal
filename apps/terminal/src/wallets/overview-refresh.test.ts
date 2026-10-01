import { describe, expect, it } from "vitest";
import { overviewRefreshInterval } from "./overview-refresh";

describe("overview refresh interval", () => {
  it("SET-AC-06 / WO-AC-16: follows the preference, never faster than 30 s, and can be turned off", () => {
    expect(overviewRefreshInterval(30)).toBe(30_000);
    expect(overviewRefreshInterval(120)).toBe(120_000);
    expect(overviewRefreshInterval(5)).toBe(30_000);
    expect(overviewRefreshInterval(0)).toBe(false);
  });
});
