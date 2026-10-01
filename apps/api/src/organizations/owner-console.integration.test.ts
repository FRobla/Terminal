import { createTestKeyPair } from "@sct/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  callAs,
  createTestApi,
  currentSessionId,
  migratorQuery,
  TEST_ORIGIN,
  type TestApi,
  type TestSession,
} from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const call = callAs;

async function ownerAndMember(memberRole: string | null = "viewer") {
  const testApi = await createTestApi();
  const owner = await testApi.signIn();
  await testApi.grantRole(owner.userId, "owner");
  const member = await testApi.signIn();
  if (memberRole) await testApi.grantRole(member.userId, memberRole);
  return { testApi, owner, member };
}

async function sessionOf(testApi: TestApi, session: TestSession) {
  const response = await call(testApi, session, "GET", "/auth/session");
  return { status: response.statusCode, data: response.json().data };
}

describe("owner console — access", () => {
  it("OWN-AC-01: every /admin route is owner-only; an admin with all other permissions is denied and audited", async () => {
    const { testApi, owner } = await ownerAndMember(null);
    api = testApi;
    const admin = await api.signIn();
    await api.grantRole(admin.userId, "admin");

    const adminRoutes = api.services.routeCatalog
      .list()
      .filter((route) => route.url.startsWith("/api/v1/admin"));
    expect(adminRoutes.length).toBeGreaterThanOrEqual(18);
    for (const route of adminRoutes) {
      expect({ route: route.url, access: route.access }).toEqual({
        route: route.url,
        access: { kind: "permission", permission: "platform.administer" },
      });
      const response = await api.app.inject({
        method: route.method as "GET",
        url: route.url.replace(":userId", owner.userId).replace(":sessionId", owner.userId),
        cookies: admin.cookies,
        headers: { origin: TEST_ORIGIN, "x-csrf-token": admin.csrfToken },
      });
      expect({ route: `${route.method} ${route.url}`, status: response.statusCode }).toEqual({
        route: `${route.method} ${route.url}`,
        status: 403,
      });
    }
    const denied = await migratorQuery<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE action = 'authorization.denied' AND metadata->>'requiredPermission' = 'platform.administer'",
    );
    expect(Number(denied[0]?.count)).toBe(adminRoutes.length);

    for (const url of [
      "/admin/overview",
      "/admin/users",
      "/admin/sessions",
      "/admin/organization",
      "/admin/roles",
    ]) {
      expect({ url, status: (await call(api, owner, "GET", url)).statusCode }).toEqual({ url, status: 200 });
    }
    const adminSession = await sessionOf(api, admin);
    expect(adminSession.data.permissions).not.toContain("platform.administer");
    expect(adminSession.data.permissions).toContain("organization.manage");
  });
});

describe("owner console — people", () => {
  it("OWN-AC-02: overview counters match the database", async () => {
    const { testApi, owner } = await ownerAndMember("auditor");
    api = testApi;
    await api.signIn(); // unaffiliated
    const overview = (await call(api, owner, "GET", "/admin/overview")).json().data;
    expect(overview.users).toEqual({ total: 3, active: 3, disabled: 0 });
    expect(overview.members).toEqual({ active: 2, suspended: 0 });
    expect(overview.roles).toEqual([
      { key: "auditor", activeMembers: 1 },
      { key: "owner", activeMembers: 1 },
    ]);
    expect(overview.activeSessions).toBe(3);
    const [audit] = await migratorQuery<{ success: string }>(
      "SELECT count(*) FILTER (WHERE result = 'success') AS success FROM audit_events",
    );
    expect(overview.audit24h.success).toBe(Number(audit?.success));
    expect(overview.readiness.status).toBe("ready");
    expect(overview.cluster.verified).toBe(true);
    expect(overview.providers[0].providerId).toEqual(expect.any(String));
  });

  it("OWN-AC-03: lists every user with identities, membership, roles, sessions, and cursor pagination", async () => {
    const { testApi, owner, member } = await ownerAndMember("trader");
    api = testApi;
    const outsider = await api.signIn();
    const users = (await call(api, owner, "GET", "/admin/users")).json().data as Array<
      Record<string, unknown>
    >;
    expect(users).toHaveLength(3);
    const byId = new Map(users.map((user) => [user.id, user]));
    expect(byId.get(owner.userId)).toMatchObject({ protectedReason: "SELF", activeSessionCount: 1 });
    expect(byId.get(member.userId)).toMatchObject({
      protectedReason: null,
      membership: { status: "active", roles: [{ key: "trader", name: "Trader" }] },
      walletIdentities: [expect.objectContaining({ address: member.identity.address })],
    });
    expect(byId.get(outsider.userId)).toMatchObject({ membership: null, lastActivityAt: expect.any(String) });

    const firstPage = await call(api, owner, "GET", "/admin/users?limit=2");
    const cursor = firstPage.json().meta.nextCursor as string;
    expect(firstPage.json().data).toHaveLength(2);
    const secondPage = await call(api, owner, "GET", `/admin/users?limit=2&cursor=${cursor}`);
    expect(secondPage.json().data).toHaveLength(1);
    expect(secondPage.json().meta.nextCursor).toBeNull();
  });

  it("OWN-AC-04: setting a role replaces existing roles, creates memberships, applies at once, and is audited", async () => {
    const { testApi, owner } = await ownerAndMember(null);
    api = testApi;
    const outsider = await api.signIn();
    expect((await sessionOf(api, outsider)).data.permissions).toEqual([]);

    const assigned = await call(api, owner, "PUT", `/admin/users/${outsider.userId}/role`, {
      roleKey: "analyst",
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data.membership.roles).toEqual([{ key: "analyst", name: "Analyst" }]);
    const asAnalyst = await sessionOf(api, outsider);
    expect(asAnalyst.data.organization.slug).toBe("default");
    expect(asAnalyst.data.permissions).toContain("trading.quote");

    await call(api, owner, "PUT", `/admin/users/${outsider.userId}/role`, { roleKey: "auditor" });
    const asAuditor = await sessionOf(api, outsider);
    expect(asAuditor.data.permissions).toContain("audit.read");
    expect(asAuditor.data.permissions).not.toContain("trading.quote");

    const events = await migratorQuery<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE action IN ('role.assigned', 'role.revoked') AND actor_id = $1 ORDER BY occurred_at",
      [owner.userId],
    );
    expect(events.map((event) => [event.action, event.metadata.roleKey])).toEqual([
      ["role.assigned", "analyst"],
      ["role.revoked", "analyst"],
      ["role.assigned", "auditor"],
    ]);
  });

  it("OWN-AC-05: refuses actions on the caller and on other owners, and never grants ownership", async () => {
    const { testApi, owner, member } = await ownerAndMember("viewer");
    api = testApi;
    const otherOwner = await api.signIn();
    await api.grantRole(otherOwner.userId, "owner");

    const self = await call(api, owner, "PUT", `/admin/users/${owner.userId}/status`, { status: "disabled" });
    expect(self.statusCode).toBe(409);
    expect(self.json()).toMatchObject({ code: "OPERATION_NOT_ALLOWED", details: { reason: "SELF" } });

    for (const [method, path, payload] of [
      ["PUT", "role", { roleKey: "viewer" }],
      ["PUT", "membership", { status: "suspended" }],
      ["PUT", "status", { status: "disabled" }],
      ["POST", "sessions/revoke", undefined],
    ] as const) {
      const response = await call(api, owner, method, `/admin/users/${otherOwner.userId}/${path}`, payload);
      expect({ path, body: response.json() }).toMatchObject({
        path,
        body: { code: "OPERATION_NOT_ALLOWED", details: { reason: "OWNER_PROTECTED" } },
      });
    }

    const grantOwner = await call(api, owner, "PUT", `/admin/users/${member.userId}/role`, {
      roleKey: "owner",
    });
    expect(grantOwner.json().code).toBe("VALIDATION_FAILED");
    expect((await sessionOf(api, otherOwner)).data.permissions).toContain("platform.administer");
    expect(
      (
        await call(api, owner, "PUT", `/admin/users/01a0f3c3-0000-7000-8000-000000000000/role`, {
          roleKey: "viewer",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("OWN-AC-06: suspending removes organization access; reactivating restores it; both are audited", async () => {
    const { testApi, owner, member } = await ownerAndMember("auditor");
    api = testApi;
    expect((await call(api, member, "GET", "/system/providers")).statusCode).toBe(200);

    const suspended = await call(api, owner, "PUT", `/admin/users/${member.userId}/membership`, {
      status: "suspended",
    });
    expect(suspended.json().data.membership.status).toBe("suspended");
    expect((await call(api, member, "GET", "/system/providers")).statusCode).toBe(403);
    expect((await sessionOf(api, member)).data.permissions).toEqual([]);

    await call(api, owner, "PUT", `/admin/users/${member.userId}/membership`, { status: "active" });
    expect((await call(api, member, "GET", "/system/providers")).statusCode).toBe(200);

    const actions = await migratorQuery<{ action: string }>(
      "SELECT action FROM audit_events WHERE action LIKE 'member.%' ORDER BY occurred_at",
    );
    expect(actions.map((row) => row.action)).toEqual(["member.suspended", "member.reactivated"]);

    const outsider = await api.signIn();
    const notMember = await call(api, owner, "PUT", `/admin/users/${outsider.userId}/membership`, {
      status: "suspended",
    });
    expect(notMember.json()).toMatchObject({
      code: "OPERATION_NOT_ALLOWED",
      details: { reason: "NOT_A_MEMBER" },
    });
  });

  it("OWN-AC-07: disabling ends sessions and blocks sign-in; enabling allows it again", async () => {
    const { testApi, owner } = await ownerAndMember(null);
    api = testApi;
    const keyPair = await createTestKeyPair();
    const member = await api.signIn(keyPair);
    await api.grantRole(member.userId, "viewer");
    await api.signIn(keyPair);

    const disabled = await call(api, owner, "PUT", `/admin/users/${member.userId}/status`, {
      status: "disabled",
    });
    expect(disabled.json().data).toMatchObject({ status: "disabled", activeSessionCount: 0 });
    expect((await sessionOf(api, member)).status).toBe(401);
    await expect(api.signIn(keyPair)).rejects.toThrow(/ACCOUNT_DISABLED/);

    await call(api, owner, "PUT", `/admin/users/${member.userId}/status`, { status: "active" });
    const again = await api.signIn(keyPair);
    expect((await sessionOf(api, again)).status).toBe(200);

    const [disabledEvent] = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'user.disabled'",
    );
    expect(disabledEvent?.metadata).toEqual({ targetUserId: member.userId, sessionsRevoked: 2 });
    const enabled = await migratorQuery("SELECT 1 FROM audit_events WHERE action = 'user.enabled'");
    expect(enabled).toHaveLength(1);
    const failedLogin = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'user.login_failed'",
    );
    expect(failedLogin[0]?.metadata.reason).toBe("account disabled");
  });

  it("OWN-AC-08: lists active sessions platform-wide and revokes them, except the caller's current session", async () => {
    const { testApi, owner, member } = await ownerAndMember("viewer");
    api = testApi;
    const sessions = (await call(api, owner, "GET", "/admin/sessions")).json().data as Array<{
      id: string;
      user: { id: string };
      current: boolean;
    }>;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.current)?.user.id).toBe(owner.userId);

    const memberSessionId = await currentSessionId(api, member);
    const revoked = await call(api, owner, "POST", `/admin/sessions/${memberSessionId}/revoke`);
    expect(revoked.json().data).toEqual({ revoked: 1 });
    expect((await sessionOf(api, member)).status).toBe(401);

    const ownSessionId = await currentSessionId(api, owner);
    const refused = await call(api, owner, "POST", `/admin/sessions/${ownSessionId}/revoke`);
    expect(refused.json().code).toBe("OPERATION_NOT_ALLOWED");
    expect((await call(api, owner, "POST", `/admin/sessions/${memberSessionId}/revoke`)).statusCode).toBe(
      404,
    );

    const again = await api.signIn(member.identity);
    const all = await call(api, owner, "POST", `/admin/users/${member.userId}/sessions/revoke`);
    expect(all.json().data).toEqual({ revoked: 1 });
    expect((await sessionOf(api, again)).status).toBe(401);
    const events = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'session.revoked' ORDER BY occurred_at",
    );
    expect(events.map((event) => [event.metadata.scope, event.metadata.reason])).toEqual([
      ["single", "owner console"],
      ["all", "owner console"],
    ]);
  });
});

describe("owner console — organization and announcement", () => {
  it("OWN-AC-10: renames the organization everywhere and exposes the role matrix from the database", async () => {
    const { testApi, owner, member } = await ownerAndMember("viewer");
    api = testApi;
    const renamed = await call(api, owner, "PATCH", "/admin/organization", { name: "Acme Treasury" });
    expect(renamed.json().data).toMatchObject({
      slug: "default",
      name: "Acme Treasury",
      members: { active: 2 },
    });
    expect((await sessionOf(api, member)).data.organization.name).toBe("Acme Treasury");
    const [event] = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'organization.updated'",
    );
    expect(event?.metadata).toEqual({
      fields: ["name"],
      previousName: "Default Organization",
      name: "Acme Treasury",
    });
    expect((await call(api, owner, "PATCH", "/admin/organization", { name: "\u0007bell" })).statusCode).toBe(
      400,
    );

    const matrix = (await call(api, owner, "GET", "/admin/roles")).json().data;
    const role = (key: string) => matrix.roles.find((entry: { key: string }) => entry.key === key);
    expect(role("owner").permissions).toContain("platform.administer");
    expect(role("admin").permissions).not.toContain("platform.administer");
    expect(role("viewer").activeMembers).toBe(1);
    expect(matrix.permissions).toContainEqual({
      key: "platform.administer",
      description: expect.stringContaining("owner console"),
    });
  });

  it("OWN-AC-11: the owner's announcement reaches every signed-in user and is audited", async () => {
    const { testApi, owner, member } = await ownerAndMember(null);
    api = testApi;
    expect((await call(api, member, "GET", "/announcements/current")).json().data).toBeNull();
    expect((await call(api, null, "GET", "/announcements/current")).statusCode).toBe(401);

    const saved = await call(api, owner, "PUT", "/admin/announcement", {
      enabled: true,
      severity: "warning",
      message: "Devnet RPC maintenance at 18:00 UTC.",
    });
    expect(saved.statusCode).toBe(200);
    const current = (await call(api, member, "GET", "/announcements/current")).json().data;
    expect(current).toMatchObject({
      enabled: true,
      severity: "warning",
      message: "Devnet RPC maintenance at 18:00 UTC.",
      updatedBy: { id: owner.userId },
    });

    const invalid = await call(api, owner, "PUT", "/admin/announcement", {
      enabled: true,
      severity: "info",
      message: "<b>‮hidden</b>",
    });
    expect(invalid.json().code).toBe("VALIDATION_FAILED");
    const [event] = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'announcement.updated'",
    );
    expect(event?.metadata).toEqual({ enabled: true, severity: "warning", messageLength: 36 });
  });
});
