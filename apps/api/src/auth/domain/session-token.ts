import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque 256-bit session token; only its SHA-256 hash is persisted (SPEC-007 §4). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Synchronizer CSRF token bound to the session id (SECURITY.md §8). */
export function csrfTokenFor(sessionId: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

export function isValidCsrfToken(candidate: string | undefined, sessionId: string, secret: Buffer): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(csrfTokenFor(sessionId, secret));
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

export interface SessionTimes {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Absolute expiry, idle timeout, and revocation (AUTH-AC-04). */
export function isSessionActive(session: SessionTimes, now: Date, idleTimeoutSeconds: number): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  return now.getTime() - session.lastSeenAt.getTime() < idleTimeoutSeconds * 1000;
}
