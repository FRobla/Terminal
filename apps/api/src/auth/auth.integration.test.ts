import { createTestKeyPair } from "@sct/testing";
import { SYSTEM_ROLES } from "@sct/validation";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApi, migratorQuery, TEST_ORIGIN, type TestApi } from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function requestChallenge(testApi: TestApi, address: string) {
  const response = await testApi.app.inject({
    method: "POST",
    url: "/api/v1/auth/siws/challenge",
    headers: { origin: TEST_ORIGIN },
    payload: { address },
  });
  return response.json().data as { challengeId: string; message: string; input: Record<string, string> };
}

async function verify(testApi: TestApi, payload: Record<string, unknown>) {
  return testApi.app.inject({
    method: "POST",
    url: "/api/v1/auth/siws/verify",
    headers: { origin: TEST_ORIGIN },
    payload,
  });
}

describe("Sign-In With Solana", () => {
  it("AUTH-AC-01: issues a single-use challenge bound to domain, URI, chain, and a 5-minute expiry", async () => {
    api = await createTestApi();
    const keyPair = await createTestKeyPair();
    const challenge = await requestChallenge(api, keyPair.address);
    expect(challenge.input.domain).toBe("localhost:3000");
    expect(challenge.input.uri).toBe(TEST_ORIGIN);
    expect(challenge.input.chainId).toBe("devnet");
    expect(challenge.input.nonce).toMatch(/^[0-9a-f]{32}$/);
    const lifetime =
      Date.parse(challenge.input.expirationTime ?? "") - Date.parse(challenge.input.issuedAt ?? "");
    expect(lifetime).toBe(5 * 60_000);
    expect(challenge.message).toContain(`Nonce: ${challenge.input.nonce}`);
  });

  it("AUTH-AC-02: a valid signature creates a hashed server-side session, sets a strict cookie, and audits the login", async () => {
    api = await createTestApi();
    const keyPair = await createTestKeyPair();
    const challenge = await requestChallenge(api, keyPair.address);
    const message = new TextEncoder().encode(challenge.message);
    const response = await verify(api, {
      challengeId: challenge.challengeId,
      address: keyPair.address,
      signedMessage: Buffer.from(message).toString("base64"),
      signature: Buffer.from(await keyPair.sign(message)).toString("base64"),
      method: "signMessage",
    });
    expect(response.statusCode).toBe(200);
    const cookie = response.cookies.find((entry) => entry.name === "sct_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });

    const sessions = await migratorQuery<{ token_hash: Buffer }>("SELECT token_hash FROM sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.token_hash.equals(Buffer.from(cookie?.value ?? ""))).toBe(false);
    expect(sessions[0]?.token_hash.length).toBe(32);

    const events = await migratorQuery<{ action: string; result: string; metadata: Record<string, unknown> }>(
      "SELECT action, result, metadata FROM audit_events WHERE action = 'user.login'",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ walletAddress: keyPair.address, method: "signMessage" });
  });

  it("AUTH-AC-03: rejects replayed, tampered, foreign-key, and unknown challenges and audits each failure", async () => {
    api = await createTestApi();
    const keyPair = await createTestKeyPair();
    const other = await createTestKeyPair();

    // Wrong key
    const challengeA = await requestChallenge(api, keyPair.address);
    const messageA = new TextEncoder().encode(challengeA.message);
    const wrongKey = await verify(api, {
      challengeId: challengeA.challengeId,
      address: keyPair.address,
      signedMessage: Buffer.from(messageA).toString("base64"),
      signature: Buffer.from(await other.sign(messageA)).toString("base64"),
      method: "signMessage",
    });
    expect(wrongKey.json().code).toBe("SIWS_SIGNATURE_INVALID");

    // The consumed challenge cannot be reused, even with a valid signature
    const replay = await verify(api, {
      challengeId: challengeA.challengeId,
      address: keyPair.address,
      signedMessage: Buffer.from(messageA).toString("base64"),
      signature: Buffer.from(await keyPair.sign(messageA)).toString("base64"),
      method: "signMessage",
    });
    expect(replay.json().code).toBe("SIWS_CHALLENGE_INVALID");

    // Tampered message (different domain) signed by the right key
    const challengeB = await requestChallenge(api, keyPair.address);
    const tampered = new TextEncoder().encode(challengeB.message.replace("localhost:3000", "evil.example"));
    const tamperedResponse = await verify(api, {
      challengeId: challengeB.challengeId,
      address: keyPair.address,
      signedMessage: Buffer.from(tampered).toString("base64"),
      signature: Buffer.from(await keyPair.sign(tampered)).toString("base64"),
      method: "signIn",
    });
    expect(tamperedResponse.json().code).toBe("SIWS_SIGNATURE_INVALID");

    // Unknown challenge
    const unknown = await verify(api, {
      challengeId: "01a0f3c3-0000-7000-8000-000000000000",
      address: keyPair.address,
      signedMessage: Buffer.from(messageA).toString("base64"),
      signature: Buffer.from(await keyPair.sign(messageA)).toString("base64"),
      method: "signMessage",
    });
    expect(unknown.json().code).toBe("SIWS_CHALLENGE_INVALID");

    const failures = await migratorQuery<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE action = 'user.login_failed' AND result = 'failure'",
    );
    expect(Number(failures[0]?.count)).toBe(4);
    const secrets = await migratorQuery<{ count: string }>(
      "SELECT count(*) FROM audit_events WHERE metadata::text ILIKE '%signature%' AND metadata ? 'signature'",
    );
    expect(Number(secrets[0]?.count)).toBe(0);
  });

  it("AUTH-AC-03: rejects an expired challenge", async () => {
    api = await createTestApi();
    const keyPair = await createTestKeyPair();
    const challenge = await requestChallenge(api, keyPair.address);
    await migratorQuery("UPDATE auth_challenges SET expires_at = now() - interval '1 second'");
    const message = new TextEncoder().encode(challenge.message);
    const response = await verify(api, {
      challengeId: challenge.challengeId,
      address: keyPair.address,
      signedMessage: Buffer.from(message).toString("base64"),
      signature: Buffer.from(await keyPair.sign(message)).toString("base64"),
      method: "signMessage",
    });
    expect(response.json().code).toBe("SIWS_CHALLENGE_INVALID");
  });

  it("AUTH-AC-04: idle and absolutely expired sessions are rejected with SESSION_EXPIRED", async () => {
    api = await createTestApi();
    const session = await api.signIn();
    await migratorQuery("UPDATE sessions SET last_seen_at = now() - interval '2 hours'");
    const idle = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: session.cookies,
    });
    expect(idle.statusCode).toBe(401);
    expect(idle.json().code).toBe("SESSION_EXPIRED");

    const second = await api.signIn();
    await migratorQuery(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE revoked_at IS NULL",
    );
    const expired = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: second.cookies,
    });
    expect(expired.json().code).toBe("SESSION_EXPIRED");
  });

  it("AUTH-AC-05: logout revokes the session server-side and audits it", async () => {
    api = await createTestApi();
    const session = await api.signIn();
    const logout = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: session.cookies,
      headers: { origin: TEST_ORIGIN, "x-csrf-token": session.csrfToken },
    });
    expect(logout.statusCode).toBe(200);
    const after = await api.app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      cookies: session.cookies,
    });
    expect(after.statusCode).toBe(401);
    const events = await migratorQuery("SELECT 1 FROM audit_events WHERE action = 'user.logout'");
    expect(events).toHaveLength(1);
  });

  it("AUTH-AC-06: state-changing requests need a valid CSRF token and our origin", async () => {
    api = await createTestApi();
    const session = await api.signIn();
    const missingToken = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: session.cookies,
      headers: { origin: TEST_ORIGIN },
    });
    expect(missingToken.json().code).toBe("CSRF_TOKEN_INVALID");

    const foreignOrigin = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: session.cookies,
      headers: { origin: "https://evil.example", "x-csrf-token": session.csrfToken },
    });
    expect(foreignOrigin.json().code).toBe("CSRF_TOKEN_INVALID");

    const publicWithoutOrigin = await api.app.inject({
      method: "POST",
      url: "/api/v1/auth/siws/challenge",
      payload: { address: session.identity.address },
    });
    expect(publicWithoutOrigin.statusCode).toBe(403);
  });
});

describe("RBAC", () => {
  it("RBAC-AC-01: a route without an access declaration prevents the server from starting", async () => {
    api = await createTestApi();
    const { default: Fastify } = await import("fastify");
    const { registerAccessControl } = await import("./http/access-control");
    const bare = Fastify();
    registerAccessControl(bare, {
      sessions: api.services.sessions,
      audit: api.services.audit,
      cookieName: "x",
      publicAppOrigin: TEST_ORIGIN,
      csrfSecret: Buffer.alloc(32),
    });
    expect(() => bare.get("/undeclared", async () => "x")).toThrow(/does not declare an access requirement/);
  });

  it("RBAC-AC-02: access is granted exactly when the role holds the required permission", async () => {
    api = await createTestApi();
    const protectedRoutes = [
      { url: (address: string) => `/api/v1/wallets/${address}/overview`, permission: "wallet.read" },
      { url: () => "/api/v1/system/providers", permission: "system.read" },
      { url: () => "/api/v1/audit/events", permission: "audit.read" },
    ] as const;
    api.stub.setHandler("getBalance", { kind: "result", result: { context: { slot: 1 }, value: 0 } });
    api.stub.setHandler("getTokenAccountsByOwner", {
      kind: "result",
      result: { context: { slot: 1 }, value: [] },
    });
    api.stub.setHandler("getSignaturesForAddress", { kind: "result", result: [] });

    for (const [roleKey, role] of Object.entries(SYSTEM_ROLES)) {
      const session = await api.signIn();
      await api.grantRole(session.userId, roleKey);
      for (const route of protectedRoutes) {
        const response = await api.app.inject({
          method: "GET",
          url: route.url(session.identity.address),
          cookies: session.cookies,
        });
        const allowed = (role.permissions as readonly string[]).includes(route.permission);
        expect({ roleKey, permission: route.permission, status: response.statusCode }).toEqual({
          roleKey,
          permission: route.permission,
          status: allowed ? 200 : 403,
        });
      }
    }
  });

  it("RBAC-AC-03 / AUD-AC-04: users without membership are denied and the denial is audited", async () => {
    api = await createTestApi();
    const session = await api.signIn();
    const response = await api.app.inject({
      method: "GET",
      url: `/api/v1/wallets/${session.identity.address}/overview`,
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("FORBIDDEN");
    const denied = await migratorQuery<{ result: string; metadata: Record<string, unknown> }>(
      "SELECT result, metadata FROM audit_events WHERE action = 'authorization.denied'",
    );
    expect(denied[0]).toMatchObject({ result: "denied", metadata: { requiredPermission: "wallet.read" } });
  });

  it("RBAC-AC-04: the bootstrap address becomes owner once; later sign-ins get no automatic membership", async () => {
    const owner = await createTestKeyPair();
    api = await createTestApi({ config: { BOOTSTRAP_OWNER_WALLET_ADDRESS: owner.address } });
    const ownerSession = await api.signIn(owner);
    const session = (
      await api.app.inject({ method: "GET", url: "/api/v1/auth/session", cookies: ownerSession.cookies })
    ).json().data;
    expect(session.organization.slug).toBe("default");
    expect(session.permissions).toContain("organization.manage");

    const assigned = await migratorQuery("SELECT 1 FROM audit_events WHERE action = 'role.assigned'");
    expect(assigned).toHaveLength(1);

    const stranger = await api.signIn();
    const strangerSession = (
      await api.app.inject({ method: "GET", url: "/api/v1/auth/session", cookies: stranger.cookies })
    ).json().data;
    expect(strangerSession.organization).toBeNull();
    expect(strangerSession.permissions).toEqual([]);

    // Signing in again as the bootstrap address does not grant a second time.
    await api.signIn(owner);
    const assignedAgain = await migratorQuery("SELECT 1 FROM audit_events WHERE action = 'role.assigned'");
    expect(assignedAgain).toHaveLength(1);
  });

  it("RBAC-AC-05: with a default member role, unaffiliated users receive it once; the bootstrap owner stays owner", async () => {
    const owner = await createTestKeyPair();
    api = await createTestApi({
      config: { BOOTSTRAP_OWNER_WALLET_ADDRESS: owner.address, DEFAULT_MEMBER_ROLE: "admin" },
    });
    await api.signIn(owner);
    const member = await createTestKeyPair();
    const memberSession = await api.signIn(member);

    const roles = await migratorQuery<{ key: string; address: string }>(
      `SELECT r.key, w.address FROM membership_roles mr
         JOIN roles r ON r.id = mr.role_id
         JOIN organization_memberships m ON m.id = mr.membership_id
         JOIN user_wallet_identities w ON w.user_id = m.user_id`,
    );
    expect(roles).toEqual(
      expect.arrayContaining([
        { key: "owner", address: owner.address },
        { key: "admin", address: member.address },
      ]),
    );
    expect(roles).toHaveLength(2);

    const memberView = (
      await api.app.inject({ method: "GET", url: "/api/v1/auth/session", cookies: memberSession.cookies })
    ).json().data;
    expect(memberView.organization.slug).toBe("default");
    expect(memberView.permissions).toContain("wallet.read");
    const overview = await api.app.inject({
      method: "GET",
      url: `/api/v1/wallets/${member.address}/overview`,
      cookies: memberSession.cookies,
    });
    expect(overview.statusCode).not.toBe(403);

    await api.signIn(member);
    await api.signIn(owner);
    const assigned = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'role.assigned'",
    );
    expect(assigned).toHaveLength(2);
    expect(assigned.map((row) => row.metadata.reason).sort()).toEqual(["bootstrap owner", "default member role"]);
  });
});
