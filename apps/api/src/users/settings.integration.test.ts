import { createTestKeyPair } from "@sct/testing";
import { DEFAULT_USER_PREFERENCES } from "@sct/validation";
import { afterEach, describe, expect, it } from "vitest";
import {
  callAs,
  createTestApi,
  currentSessionId,
  migratorQuery,
  TEST_ORIGIN,
  type TestApi,
} from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const call = callAs;

describe("user settings — profile", () => {
  it("SET-AC-09: /me routes require a session and CSRF on state changes", async () => {
    api = await createTestApi();
    expect((await call(api, null, "GET", "/me/profile")).json().code).toBe("UNAUTHENTICATED");
    expect((await call(api, null, "GET", "/me/preferences")).statusCode).toBe(401);
    expect((await call(api, null, "GET", "/me/sessions")).statusCode).toBe(401);

    const session = await api.signIn();
    const withoutToken = await api.app.inject({
      method: "PATCH",
      url: "/api/v1/me/profile",
      cookies: session.cookies,
      headers: { origin: TEST_ORIGIN },
      payload: { displayName: "Ana" },
    });
    expect(withoutToken.json().code).toBe("CSRF_TOKEN_INVALID");
  });

  it("SET-AC-02: the profile lists identities, organization, roles, and permissions from the API", async () => {
    api = await createTestApi();
    const unaffiliated = await api.signIn();
    const bare = (await call(api, unaffiliated, "GET", "/me/profile")).json().data;
    expect(bare.organization).toBeNull();
    expect(bare.roles).toEqual([]);
    expect(bare.permissions).toEqual([]);
    expect(bare.walletIdentities).toEqual([
      expect.objectContaining({ address: unaffiliated.identity.address, cluster: "devnet" }),
    ]);

    const member = await api.signIn();
    await api.grantRole(member.userId, "analyst");
    const profile = (await call(api, member, "GET", "/me/profile")).json().data;
    expect(profile.organization.slug).toBe("default");
    expect(profile.roles).toEqual([{ key: "analyst", name: "Analyst" }]);
    expect(profile.permissions).toContain("wallet.read");
    expect(profile.permissions).not.toContain("platform.administer");
  });

  it("SET-AC-03: a valid display name is saved, shown in the session, and audited; invalid names are rejected", async () => {
    api = await createTestApi();
    const session = await api.signIn();

    const saved = await call(api, session, "PATCH", "/me/profile", { displayName: "  Ana Treasury  " });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.user.displayName).toBe("Ana Treasury");
    const current = (await call(api, session, "GET", "/auth/session")).json().data;
    expect(current.user.displayName).toBe("Ana Treasury");

    for (const displayName of ["   ", "x".repeat(65), "Ana‮yrusaert", "line\nbreak", "zero​width"]) {
      const rejected = await call(api, session, "PATCH", "/me/profile", { displayName });
      expect({ displayName, code: rejected.json().code }).toEqual({ displayName, code: "VALIDATION_FAILED" });
    }

    const cleared = await call(api, session, "PATCH", "/me/profile", { displayName: null });
    expect(cleared.json().data.user.displayName).toBeNull();

    const events = await migratorQuery<{ metadata: Record<string, unknown>; actor_id: string }>(
      "SELECT metadata, actor_id FROM audit_events WHERE action = 'user.profile_updated'",
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actor_id: session.userId, metadata: { fields: ["displayName"] } });
  });
});

describe("user settings — preferences", () => {
  it("SET-AC-04: preferences default, persist per user, and reject unknown keys and out-of-range values", async () => {
    api = await createTestApi();
    const first = await api.signIn();
    const second = await api.signIn();
    expect((await call(api, first, "GET", "/me/preferences")).json().data).toEqual(DEFAULT_USER_PREFERENCES);

    const updated = {
      ...DEFAULT_USER_PREFERENCES,
      timeZone: "utc",
      density: "comfortable",
      explorer: "solscan",
      overviewRefreshSeconds: 60,
      keyboardShortcuts: false,
      addressDisplay: "full",
      reduceMotion: true,
    };
    expect((await call(api, first, "PUT", "/me/preferences", updated)).statusCode).toBe(200);
    expect((await call(api, first, "GET", "/me/preferences")).json().data).toEqual(updated);
    expect((await call(api, second, "GET", "/me/preferences")).json().data).toEqual(DEFAULT_USER_PREFERENCES);

    const unknownKey = await call(api, first, "PUT", "/me/preferences", { ...updated, theme: "light" });
    expect(unknownKey.json().code).toBe("VALIDATION_FAILED");
    const tooFast = await call(api, first, "PUT", "/me/preferences", {
      ...updated,
      overviewRefreshSeconds: 10,
    });
    expect(tooFast.json().code).toBe("VALIDATION_FAILED");
    const partial = await call(api, first, "PUT", "/me/preferences", { timeZone: "utc" });
    expect(partial.json().code).toBe("VALIDATION_FAILED");
  });

  it("SET-AC-05: stored unknown keys are dropped and invalid values fall back to defaults", async () => {
    api = await createTestApi();
    const session = await api.signIn();
    await migratorQuery(
      `INSERT INTO user_preferences (user_id, schema_version, preferences) VALUES ($1, 0, $2::jsonb)`,
      [session.userId, JSON.stringify({ timeZone: "utc", density: "huge", legacyTheme: "light" })],
    );
    const preferences = (await call(api, session, "GET", "/me/preferences")).json().data;
    expect(preferences).toEqual({ ...DEFAULT_USER_PREFERENCES, timeZone: "utc" });
    expect(preferences).not.toHaveProperty("legacyTheme");
  });
});

describe("user settings — sessions", () => {
  it("SET-AC-07: lists only the caller's active sessions and marks the current one", async () => {
    api = await createTestApi();
    const keyPair = await createTestKeyPair();
    const current = await api.signIn(keyPair);
    await api.signIn(keyPair);
    const idle = await api.signIn(keyPair);
    const revoked = await api.signIn(keyPair);
    const stranger = await api.signIn();

    const idleId = await currentSessionId(api, idle);
    await migratorQuery(`UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE id = $1`, [
      idleId,
    ]);
    await call(api, revoked, "POST", "/auth/logout");

    const sessions = (await call(api, current, "GET", "/me/sessions")).json().data as Array<{
      id: string;
      current: boolean;
      walletAddress: string;
    }>;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    expect(sessions.every((session) => session.walletAddress === keyPair.address)).toBe(true);
    expect(sessions.map((session) => session.id)).not.toContain(idleId);
    const strangerSessions = (await call(api, stranger, "GET", "/me/sessions")).json().data;
    expect(strangerSessions).toHaveLength(1);
  });

  it("SET-AC-08: revokes one or all other sessions, refuses the current one, and hides other users' sessions", async () => {
    api = await createTestApi();
    const keyPair = await createTestKeyPair();
    const current = await api.signIn(keyPair);
    const second = await api.signIn(keyPair);
    const third = await api.signIn(keyPair);
    const stranger = await api.signIn();

    const currentId = await currentSessionId(api, current);
    const strangerId = await currentSessionId(api, stranger);

    const refuseCurrent = await call(api, current, "POST", `/me/sessions/${currentId}/revoke`);
    expect(refuseCurrent.statusCode).toBe(409);
    expect(refuseCurrent.json().code).toBe("OPERATION_NOT_ALLOWED");

    const foreign = await call(api, current, "POST", `/me/sessions/${strangerId}/revoke`);
    expect(foreign.statusCode).toBe(404);
    expect((await call(api, stranger, "GET", "/auth/session")).statusCode).toBe(200);

    const secondId = await currentSessionId(api, second);
    const single = await call(api, current, "POST", `/me/sessions/${secondId}/revoke`);
    expect(single.json().data).toEqual({ revoked: 1 });
    expect((await call(api, second, "GET", "/auth/session")).statusCode).toBe(401);
    expect((await call(api, third, "GET", "/auth/session")).statusCode).toBe(200);

    const others = await call(api, current, "POST", "/me/sessions/revoke-others");
    expect(others.json().data).toEqual({ revoked: 1 });
    expect((await call(api, third, "GET", "/auth/session")).statusCode).toBe(401);
    expect((await call(api, current, "GET", "/auth/session")).statusCode).toBe(200);

    const events = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'session.revoked' ORDER BY occurred_at",
    );
    expect(events.map((event) => event.metadata.scope)).toEqual(["single", "others"]);
    expect(events.every((event) => event.metadata.reason === "self service")).toBe(true);
  });
});
