import { afterEach, describe, expect, it } from "vitest";
import { createTestApi, migratorQuery, type TestApi } from "../../test/harness";
import { AUDIT_ACTION_METADATA, type AuditAction } from "./domain/audit-actions";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe("audit log", () => {
  it("AUD-AC-01: records carry the required correlation fields", async () => {
    api = await createTestApi();
    await api.signIn();
    const [event] = await migratorQuery<Record<string, unknown>>(
      "SELECT occurred_at, actor_type, actor_id, action, resource_type, result, request_id FROM audit_events WHERE action = 'user.login'",
    );
    expect(event).toMatchObject({
      actor_type: "user",
      action: "user.login",
      resource_type: "session",
      result: "success",
    });
    expect(event?.occurred_at).toBeInstanceOf(Date);
    expect(event?.actor_id).toEqual(expect.any(String));
    expect(event?.request_id).toEqual(expect.any(String));
  });

  it("AUD-AC-03: denylisted keys are never persisted for any action", async () => {
    api = await createTestApi();
    const secrets = {
      privateKey: "x",
      secretKey: "x",
      seed: "x",
      mnemonic: "x",
      passphrase: "x",
      password: "x",
      signature: "x",
      token: "x",
      apiKey: "x",
      cookie: "x",
    };
    const samples: { [A in AuditAction]: Record<string, unknown> } = {
      "user.login": { walletAddress: "a", method: "signIn" },
      "user.login_failed": { walletAddress: null, reason: "r" },
      "user.logout": {},
      "wallet.connected": { address: "a", walletName: "w", walletChains: [] },
      "wallet.connection_rejected": {
        address: "a",
        walletName: "w",
        walletChains: [],
        reason: "CLUSTER_MISMATCH",
      },
      "role.assigned": {
        roleKey: "owner",
        targetUserId: "01a0f3c3-0000-7000-8000-000000000000",
        reason: "r",
      },
      "authorization.denied": { requiredPermission: "wallet.read", route: "GET /x" },
      "user.profile_updated": { fields: ["displayName"] },
      "session.revoked": {
        targetUserId: "01a0f3c3-0000-7000-8000-000000000000",
        scope: "single",
        reason: "self service",
        count: 1,
      },
      "role.revoked": {
        roleKey: "viewer",
        targetUserId: "01a0f3c3-0000-7000-8000-000000000000",
        reason: "r",
      },
      "member.suspended": { targetUserId: "01a0f3c3-0000-7000-8000-000000000000" },
      "member.reactivated": { targetUserId: "01a0f3c3-0000-7000-8000-000000000000" },
      "user.disabled": { targetUserId: "01a0f3c3-0000-7000-8000-000000000000", sessionsRevoked: 0 },
      "user.enabled": { targetUserId: "01a0f3c3-0000-7000-8000-000000000000" },
      "organization.updated": { fields: ["name"], previousName: "a", name: "b" },
      "announcement.updated": { enabled: true, severity: "info", messageLength: 3 },
      "system.cluster_verification_requested": { verified: true },
      "system.job_enqueued": { queue: "q", jobName: "j" },
      "system.cache_purged": { target: "permissions", keysDeleted: 0 },
    };
    for (const action of Object.keys(AUDIT_ACTION_METADATA) as AuditAction[]) {
      await api.services.audit.record({
        action,
        resourceType: "test",
        result: "success",
        actorType: "system",
        metadata: { ...samples[action], ...secrets, nested: secrets } as never,
      });
    }
    const rows = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events",
    );
    expect(rows).toHaveLength(Object.keys(AUDIT_ACTION_METADATA).length);
    for (const row of rows) {
      const serialized = JSON.stringify(row.metadata);
      for (const key of Object.keys(secrets)) expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it("AUD-AC-05: listing is scoped to the active organization, newest first, and paginated", async () => {
    api = await createTestApi();
    const auditor = await api.signIn();
    await api.grantRole(auditor.userId, "auditor");
    await api.signIn(); // another login event, without organization
    await api.signIn(auditor.identity); // second login for the auditor, now within the organization

    const first = await api.app.inject({
      method: "GET",
      url: "/api/v1/audit/events?limit=1",
      cookies: auditor.cookies,
    });
    expect(first.statusCode).toBe(200);
    const page = first.json();
    expect(page.data).toHaveLength(1);
    expect(page.meta.nextCursor).toEqual(expect.any(String));

    const all = (
      await api.app.inject({ method: "GET", url: "/api/v1/audit/events?limit=100", cookies: auditor.cookies })
    ).json().data;
    const organizationIds = new Set(all.map((event: { organizationId: string }) => event.organizationId));
    expect(organizationIds.size).toBe(1);
    expect([...organizationIds][0]).not.toBeNull();
    const times = all.map((event: { occurredAt: string }) => Date.parse(event.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const next = await api.app.inject({
      method: "GET",
      url: `/api/v1/audit/events?limit=1&cursor=${page.meta.nextCursor}`,
      cookies: auditor.cookies,
    });
    expect(next.json().data[0]?.id).not.toBe(page.data[0].id);
  });
});
