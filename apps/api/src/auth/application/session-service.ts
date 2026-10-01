import type { Permission } from "@sct/validation";
import { csrfTokenFor, hashSessionToken, isSessionActive } from "../domain/session-token";
import type { MembershipStore, OrganizationSummary, SessionStore } from "./ports";

export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  displayName: string | null;
  walletAddress: string;
  organization: OrganizationSummary | null;
  permissions: ReadonlySet<Permission>;
  csrfToken: string;
  expiresAt: Date;
}

export type SessionResolution =
  { status: "authenticated"; session: AuthenticatedSession } | { status: "expired" } | { status: "missing" };

const PERMISSION_CACHE_TTL_MS = 60_000;
const TOUCH_INTERVAL_MS = 60_000;

/** Resolves session cookies into authenticated sessions (SPEC-007 §4). */
export class SessionService {
  private readonly permissionCache = new Map<
    string,
    { loadedAt: number; organization: OrganizationSummary | null; permissions: ReadonlySet<Permission> }
  >();

  constructor(
    private readonly config: { idleTimeoutSeconds: number; csrfSecret: Buffer },
    private readonly deps: { sessions: SessionStore; memberships: MembershipStore; now?: () => Date },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async resolve(token: string | undefined): Promise<SessionResolution> {
    if (!token) return { status: "missing" };
    const stored = await this.deps.sessions.findByTokenHash(hashSessionToken(token));
    if (!stored) return { status: "missing" };

    const now = this.now();
    if (!isSessionActive(stored, now, this.config.idleTimeoutSeconds)) {
      if (!stored.revokedAt) await this.deps.sessions.revoke(stored.id, now);
      this.permissionCache.delete(stored.id);
      return { status: "expired" };
    }
    if (now.getTime() - stored.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      await this.deps.sessions.touch(stored.id, now);
    }

    const access = await this.loadAccess(stored.id, stored.userId, stored.activeOrganizationId, now);
    return {
      status: "authenticated",
      session: {
        sessionId: stored.id,
        userId: stored.userId,
        displayName: stored.displayName,
        walletAddress: stored.walletAddress,
        organization: access.organization,
        permissions: access.permissions,
        csrfToken: csrfTokenFor(stored.id, this.config.csrfSecret),
        expiresAt: stored.expiresAt,
      },
    };
  }

  private async loadAccess(sessionId: string, userId: string, organizationId: string | null, now: Date) {
    const cached = this.permissionCache.get(sessionId);
    if (cached && now.getTime() - cached.loadedAt < PERMISSION_CACHE_TTL_MS) return cached;

    const organization = organizationId ? await this.deps.memberships.findOrganization(organizationId) : null;
    const permissions = new Set(
      organization ? await this.deps.memberships.loadPermissions(userId, organization.id) : [],
    );
    const entry = { loadedAt: now.getTime(), organization, permissions };
    this.permissionCache.set(sessionId, entry);
    return entry;
  }

  /** AUTH-AC-05 */
  async revoke(sessionId: string): Promise<void> {
    this.permissionCache.delete(sessionId);
    await this.deps.sessions.revoke(sessionId, this.now());
  }

  /** Drops cached permissions so role changes take effect immediately. Returns the number of entries dropped. */
  invalidatePermissions(): number {
    const size = this.permissionCache.size;
    this.permissionCache.clear();
    return size;
  }
}
