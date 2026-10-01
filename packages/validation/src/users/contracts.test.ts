import { describe, expect, it } from "vitest";
import { announcementInputSchema } from "../announcements/contracts";
import { SYSTEM_ROLES } from "../auth/permissions";
import {
  DEFAULT_USER_PREFERENCES,
  displayNameSchema,
  readStoredPreferences,
  userPreferencesSchema,
} from "./contracts";

describe("user preferences", () => {
  it("SET-AC-04: defaults satisfy the strict schema; unknown keys and sub-30 s refresh are rejected", () => {
    expect(userPreferencesSchema.parse(DEFAULT_USER_PREFERENCES)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(userPreferencesSchema.safeParse({ ...DEFAULT_USER_PREFERENCES, theme: "light" }).success).toBe(
      false,
    );
    expect(
      userPreferencesSchema.safeParse({ ...DEFAULT_USER_PREFERENCES, overviewRefreshSeconds: 15 }).success,
    ).toBe(false);
    expect(
      userPreferencesSchema.safeParse({ ...DEFAULT_USER_PREFERENCES, overviewRefreshSeconds: 0 }).success,
    ).toBe(true);
  });

  it("SET-AC-05: stored values are read tolerantly, key by key", () => {
    expect(readStoredPreferences(null)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(readStoredPreferences("garbage")).toEqual(DEFAULT_USER_PREFERENCES);
    expect(
      readStoredPreferences({ timeZone: "utc", explorer: "etherscan", keyboardShortcuts: false, extra: 1 }),
    ).toEqual({ ...DEFAULT_USER_PREFERENCES, timeZone: "utc", keyboardShortcuts: false });
  });
});

describe("user-supplied text", () => {
  it("SET-AC-03: display names are trimmed, bounded, and free of control and format characters", () => {
    expect(displayNameSchema.parse("  Ana  ")).toBe("Ana");
    expect(displayNameSchema.safeParse("").success).toBe(false);
    expect(displayNameSchema.safeParse("a".repeat(65)).success).toBe(false);
    for (const value of ["a\u0000b", "a‮b", "a​b", "a\nb", "a b"]) {
      expect({ value, ok: displayNameSchema.safeParse(value).success }).toEqual({ value, ok: false });
    }
    expect(displayNameSchema.parse("Zoë Ñúñez 李")).toBe("Zoë Ñúñez 李");
  });

  it("OWN-AC-11: announcement messages follow the same rules up to 500 characters", () => {
    const valid = { enabled: true, severity: "info", message: "Maintenance tonight." };
    expect(announcementInputSchema.safeParse(valid).success).toBe(true);
    expect(announcementInputSchema.safeParse({ ...valid, message: "x".repeat(501) }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ ...valid, severity: "emergency" }).success).toBe(false);
  });
});

describe("owner-only permissions", () => {
  it("OWN-AC-01: only the owner role holds platform.administer", () => {
    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      const holds = (role.permissions as readonly string[]).includes("platform.administer");
      expect({ key, holds }).toEqual({ key, holds: key === "owner" });
    }
  });
});
