import { describe, expect, it } from "vitest";
import {
  csrfTokenFor,
  generateSessionToken,
  hashSessionToken,
  isSessionActive,
  isValidCsrfToken,
} from "./session-token";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const minutes = (value: number) => new Date(NOW.getTime() + value * 60_000);

describe("session tokens", () => {
  it("generates 256-bit tokens and stores only a SHA-256 hash", () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashSessionToken(token)).toHaveLength(32);
    expect(hashSessionToken(token).toString("base64url")).not.toBe(token);
  });

  it("AUTH-AC-06: CSRF tokens are bound to the session and secret", () => {
    const secret = Buffer.alloc(32, 1);
    const token = csrfTokenFor("session-a", secret);
    expect(isValidCsrfToken(token, "session-a", secret)).toBe(true);
    expect(isValidCsrfToken(token, "session-b", secret)).toBe(false);
    expect(isValidCsrfToken(token, "session-a", Buffer.alloc(32, 2))).toBe(false);
    expect(isValidCsrfToken(undefined, "session-a", secret)).toBe(false);
    expect(isValidCsrfToken("short", "session-a", secret)).toBe(false);
  });

  it("AUTH-AC-04: enforces idle timeout, absolute expiry, and revocation", () => {
    const base = {
      createdAt: minutes(-60),
      lastSeenAt: minutes(-10),
      expiresAt: minutes(60),
      revokedAt: null,
    };
    expect(isSessionActive(base, NOW, 1800)).toBe(true);
    expect(isSessionActive({ ...base, lastSeenAt: minutes(-31) }, NOW, 1800)).toBe(false);
    expect(isSessionActive({ ...base, expiresAt: NOW }, NOW, 1800)).toBe(false);
    expect(isSessionActive({ ...base, revokedAt: minutes(-1) }, NOW, 1800)).toBe(false);
  });
});
