import { createTestKeyPair, type TestKeyPair } from "@sct/testing";
import { SYSTEM_ROLES } from "@sct/validation";
import { afterEach, describe, expect, it } from "vitest";
import { callAs, createTestApi, migratorQuery, type TestApi, type TestSession } from "../../test/harness";

let api: TestApi | undefined;

afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function operator(testApi: TestApi, roleKey = "operator"): Promise<TestSession> {
  const session = await testApi.signIn();
  await testApi.grantRole(session.userId, roleKey);
  return session;
}

async function proveControl(testApi: TestApi, session: TestSession, wallet: TestKeyPair) {
  const challenge = await callAs(testApi, session, "POST", "/wallets/ownership-challenges", {
    address: wallet.address,
  });
  expect(challenge.statusCode).toBe(200);
  const { challengeId, message } = challenge.json().data as { challengeId: string; message: string };
  const signature = await wallet.sign(new TextEncoder().encode(message));
  return { challengeId, signature: Buffer.from(signature).toString("base64"), message };
}

function balances(lamportsByAddress: Record<string, number | null>) {
  return (params: unknown[]) => {
    const addresses = params[0] as string[];
    return {
      kind: "result" as const,
      result: {
        context: { slot: 77 },
        value: addresses.map((address) => {
          const lamports = lamportsByAddress[address];
          return lamports === undefined || lamports === null
            ? null
            : {
                lamports,
                owner: "11111111111111111111111111111111",
                data: ["", "base64"],
                executable: false,
                rentEpoch: 0,
                space: 0,
              };
        }),
      },
    };
  };
}

describe("Wallet registry (SPEC-009)", () => {
  it("WRG-AC-01: registers a watch-only wallet with CREATOR, sync state, audit, and an initial sync job", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const watched = await createTestKeyPair();

    const response = await callAs(api, session, "POST", "/wallets", {
      custodyType: "WATCH_ONLY",
      address: watched.address,
      label: "  Counterparty  ",
      category: "RESEARCH",
      tags: ["Market-Maker", "q4"],
    });

    expect(response.statusCode).toBe(200);
    const wallet = response.json().data;
    expect(wallet).toMatchObject({
      address: watched.address,
      cluster: "devnet",
      label: "Counterparty",
      category: "RESEARCH",
      custodyType: "WATCH_ONLY",
      status: "active",
      tags: ["market-maker", "q4"],
      myRoles: ["CREATOR"],
      sync: { indexedCount: 0, lastSuccessAt: null },
    });
    expect(wallet.assignments).toEqual([
      expect.objectContaining({
        userId: session.userId,
        role: "CREATOR",
        walletAddress: session.identity.address,
      }),
    ]);

    const audit = await migratorQuery<{ metadata: Record<string, unknown>; resource_id: string }>(
      "SELECT metadata, resource_id FROM audit_events WHERE action = 'wallet.created'",
    );
    expect(audit).toEqual([
      {
        resource_id: wallet.id,
        metadata: { address: watched.address, custodyType: "WATCH_ONLY", category: "RESEARCH" },
      },
    ]);
    const jobs = await api.services.redis.keys(`bull:wallets.sync:sync-${wallet.id}-registered`);
    expect(jobs).toHaveLength(1);
  });

  it("WRG-AC-02: registers a browser wallet with a signed ownership challenge and consumes the challenge", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const controlled = await createTestKeyPair();
    const proof = await proveControl(api, session, controlled);
    expect(proof.message).toContain(`Account: ${controlled.address}`);
    expect(proof.message).toContain("Network: devnet");
    expect(proof.message).toContain("Signing this message does not authorize any transaction.");

    const payload = {
      custodyType: "BROWSER_WALLET",
      address: controlled.address,
      label: "Treasury hot",
      category: "TREASURY",
      ownership: { challengeId: proof.challengeId, signature: proof.signature },
    };
    const response = await callAs(api, session, "POST", "/wallets", payload);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ custodyType: "BROWSER_WALLET", category: "TREASURY" });

    const [challenge] = await migratorQuery<{ consumed_at: Date | null }>(
      "SELECT consumed_at FROM wallet_ownership_challenges WHERE id = $1",
      [proof.challengeId],
    );
    expect(challenge?.consumed_at).not.toBeNull();
  });

  it("WRG-AC-03: ownership proof is enforced and rejections are audited", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const other = await operator(api);
    const controlled = await createTestKeyPair();
    const impostor = await createTestKeyPair();
    const register = (ownership: { challengeId: string; signature: string }, address = controlled.address) =>
      callAs(api!, session, "POST", "/wallets", {
        custodyType: "LOCAL_ENCRYPTED",
        address,
        label: "Local",
        category: "DEVELOPMENT",
        ownership,
      });

    // Signed by another key.
    const wrongSigner = await proveControl(api, session, controlled);
    const forged = await impostor.sign(new TextEncoder().encode(wrongSigner.message));
    let response = await register({
      challengeId: wrongSigner.challengeId,
      signature: Buffer.from(forged).toString("base64"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "WALLET_OWNERSHIP_UNVERIFIED",
      details: { reason: "SIGNATURE_INVALID" },
    });

    // Bound to another user.
    const foreign = await proveControl(api, other, controlled);
    response = await register({ challengeId: foreign.challengeId, signature: foreign.signature });
    expect(response.json().details.reason).toBe("CHALLENGE_BINDING_MISMATCH");

    // Bound to another address.
    const otherAddress = await proveControl(api, session, impostor);
    response = await register({ challengeId: otherAddress.challengeId, signature: otherAddress.signature });
    expect(response.json().details.reason).toBe("CHALLENGE_BINDING_MISMATCH");

    // Expired.
    const expired = await proveControl(api, session, controlled);
    await migratorQuery(
      "UPDATE wallet_ownership_challenges SET expires_at = now() - interval '1 second' WHERE id = $1",
      [expired.challengeId],
    );
    response = await register({ challengeId: expired.challengeId, signature: expired.signature });
    expect(response.json().details.reason).toBe("CHALLENGE_EXPIRED");

    // Unknown challenge.
    response = await register({
      challengeId: "01a0f3c3-0000-7000-8000-000000000000",
      signature: expired.signature,
    });
    expect(response.json().details.reason).toBe("CHALLENGE_NOT_FOUND");

    // Consumed.
    const valid = await proveControl(api, session, controlled);
    expect((await register({ challengeId: valid.challengeId, signature: valid.signature })).statusCode).toBe(
      200,
    );
    for (const table of ["wallet_sync_state", "wallet_assignments", "managed_wallets"]) {
      await migratorQuery(`DELETE FROM ${table}`);
    }
    response = await register({ challengeId: valid.challengeId, signature: valid.signature });
    expect(response.json().details.reason).toBe("CHALLENGE_CONSUMED");

    const wallets = await migratorQuery("SELECT 1 FROM managed_wallets");
    expect(wallets).toHaveLength(0);
    const rejected = await migratorQuery<{ metadata: { reason: string } }>(
      "SELECT metadata FROM audit_events WHERE action = 'wallet.registration_rejected' ORDER BY occurred_at",
    );
    expect(rejected.map((row) => row.metadata.reason)).toEqual([
      "SIGNATURE_INVALID",
      "CHALLENGE_BINDING_MISMATCH",
      "CHALLENGE_BINDING_MISMATCH",
      "CHALLENGE_EXPIRED",
      "CHALLENGE_NOT_FOUND",
      "CHALLENGE_CONSUMED",
    ]);
  });

  it("WRG-AC-04: registration validation", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const watched = await createTestKeyPair();
    const base = {
      custodyType: "WATCH_ONLY",
      address: watched.address,
      label: "Watched",
      category: "RESEARCH",
    };
    const post = (payload: Record<string, unknown>) => callAs(api!, session, "POST", "/wallets", payload);

    expect((await post({ ...base, address: "not-an-address" })).json().code).toBe("VALIDATION_FAILED");
    expect((await post({ ...base, address: "z".repeat(44) })).json().code).toBe("WALLET_ADDRESS_INVALID");
    expect((await post({ ...base, label: "   " })).json().code).toBe("VALIDATION_FAILED");
    expect((await post({ ...base, label: "x".repeat(65) })).json().code).toBe("VALIDATION_FAILED");
    expect((await post({ ...base, tags: ["bad tag"] })).json().code).toBe("VALIDATION_FAILED");
    expect((await post({ ...base, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) })).json().code).toBe(
      "VALIDATION_FAILED",
    );
    const controlled = await createTestKeyPair();
    const proof = await proveControl(api, session, controlled);
    const reserved = await post({
      custodyType: "BROWSER_WALLET",
      address: controlled.address,
      label: "x",
      category: "WATCH_ONLY",
      ownership: { challengeId: proof.challengeId, signature: proof.signature },
    });
    expect(reserved.json().code).toBe("VALIDATION_FAILED");

    expect((await post(base)).statusCode).toBe(200);
    const duplicate = await post(base);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe("WALLET_ALREADY_REGISTERED");

    const [organization] = await migratorQuery<{ id: string }>(
      "SELECT id FROM organizations WHERE slug = 'default'",
    );
    await migratorQuery(
      `INSERT INTO managed_wallets (id, organization_id, address, cluster, label, category, custody_type, created_by_user_id)
       SELECT gen_random_uuid(), $1, 'filler' || g, 'devnet', 'Filler', 'RESEARCH', 'WATCH_ONLY', $2
       FROM generate_series(1, 499) g`,
      [organization!.id, session.userId],
    );
    const another = await createTestKeyPair();
    const capped = await post({ ...base, address: another.address });
    expect(capped.statusCode).toBe(409);
    expect(capped.json().code).toBe("OPERATION_NOT_ALLOWED");
  });

  it("WRG-AC-05: signing in does not register the sign-in wallet", async () => {
    api = await createTestApi({ rpcHandlers: { getMultipleAccounts: balances({}) } });
    const session = await operator(api);
    const response = await callAs(api, session, "GET", "/wallets");
    expect(response.statusCode).toBe(200);
    expect(response.json().data.wallets).toEqual([]);
  });

  it("WRG-AC-06: lists organization wallets with filters, cursor pages, and batched balances", async () => {
    const funded = await createTestKeyPair();
    const unfunded = await createTestKeyPair();
    const third = await createTestKeyPair();
    api = await createTestApi({
      rpcHandlers: { getMultipleAccounts: balances({ [funded.address]: 2_500_000_000 }) },
    });
    const session = await operator(api);
    const register = (address: string, label: string, category: string, tags: string[]) =>
      callAs(api!, session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address,
        label,
        category,
        tags,
      });
    const first = (await register(funded.address, "Treasury watch", "TREASURY", ["ops"])).json().data;
    const second = (await register(unfunded.address, "Research one", "RESEARCH", [])).json().data;
    const third_ = (await register(third.address, "Research two", "RESEARCH", ["ops"])).json().data;

    const all = await callAs(api, session, "GET", "/wallets");
    const data = all.json().data;
    expect(data.wallets.map((wallet: { id: string }) => wallet.id)).toEqual([third_.id, second.id, first.id]);
    expect(data.balances.status).toBe("AVAILABLE");
    expect(data.balances.provenance).toMatchObject({
      method: "getMultipleAccounts",
      slot: "77",
      commitment: "confirmed",
    });
    expect(data.balances.value).toEqual(
      expect.arrayContaining([
        { walletId: first.id, lamports: "2500000000" },
        { walletId: second.id, lamports: "0" },
      ]),
    );
    expect(api.stub.calls.get("getMultipleAccounts")).toBe(1);

    const ids = (query: string) =>
      callAs(api!, session, "GET", `/wallets${query}`).then((response) =>
        response.json().data.wallets.map((wallet: { id: string }) => wallet.id),
      );
    expect(await ids("?category=RESEARCH")).toEqual([third_.id, second.id]);
    expect(await ids("?tag=ops")).toEqual([third_.id, first.id]);
    expect(await ids("?q=treasury")).toEqual([first.id]);
    expect(await ids(`?q=${funded.address.slice(0, 6)}`)).toEqual([first.id]);
    expect(await ids("?custodyType=BROWSER_WALLET")).toEqual([]);

    const page = await callAs(api, session, "GET", "/wallets?limit=2");
    expect(page.json().meta.nextCursor).toBe(second.id);
    expect(await ids(`?limit=2&cursor=${second.id}`)).toEqual([first.id]);

    await callAs(api, session, "PATCH", `/wallets/${second.id}`, { status: "archived" });
    expect(await ids("")).toEqual([third_.id, first.id]);
    expect(await ids("?status=archived")).toEqual([second.id]);
  });

  it("WRG-AC-06: an RPC failure makes balances UNAVAILABLE while the list is still returned", async () => {
    api = await createTestApi({ rpcHandlers: { getMultipleAccounts: { kind: "http-error", status: 503 } } });
    const session = await operator(api);
    const watched = await createTestKeyPair();
    await callAs(api, session, "POST", "/wallets", {
      custodyType: "WATCH_ONLY",
      address: watched.address,
      label: "Watched",
      category: "RESEARCH",
    });
    const response = await callAs(api, session, "GET", "/wallets");
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.wallets).toHaveLength(1);
    expect(data.balances).toMatchObject({
      status: "UNAVAILABLE",
      unavailable: { reason: "RPC_UNAVAILABLE" },
    });
  });

  it("WRG-AC-07: wallets are isolated by organization", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const watched = await createTestKeyPair();
    const wallet = (
      await callAs(api, session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;

    const detail = await callAs(api, session, "GET", `/wallets/${wallet.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({ id: wallet.id, sync: { indexedCount: 0 } });

    const outsider = await api.signIn();
    const [organization] = await migratorQuery<{ id: string }>(
      "INSERT INTO organizations (id, slug, name) VALUES (gen_random_uuid(), 'wrg-ac-07', 'Other') ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id",
    );
    try {
      const [membership] = await migratorQuery<{ id: string }>(
        "INSERT INTO organization_memberships (id, organization_id, user_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id",
        [organization!.id, outsider.userId],
      );
      await migratorQuery(
        "INSERT INTO membership_roles (membership_id, role_id) SELECT $1, id FROM roles WHERE organization_id IS NULL AND key = 'operator'",
        [membership!.id],
      );
      await migratorQuery("UPDATE sessions SET active_organization_id = $1 WHERE user_id = $2", [
        organization!.id,
        outsider.userId,
      ]);
      api.services.sessions.invalidatePermissions();

      const foreign = await callAs(api, outsider, "GET", `/wallets/${wallet.id}`);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json().code).toBe("WALLET_NOT_FOUND");
      expect((await callAs(api, outsider, "PATCH", `/wallets/${wallet.id}`, { label: "x" })).statusCode).toBe(
        404,
      );
    } finally {
      await migratorQuery(
        "UPDATE sessions SET active_organization_id = NULL WHERE active_organization_id = $1",
        [organization!.id],
      );
      await migratorQuery(
        "DELETE FROM membership_roles WHERE membership_id IN (SELECT id FROM organization_memberships WHERE organization_id = $1)",
        [organization!.id],
      );
      await migratorQuery("DELETE FROM organization_memberships WHERE organization_id = $1", [
        organization!.id,
      ]);
      await migratorQuery("DELETE FROM organizations WHERE id = $1", [organization!.id]);
    }
  });

  it("WRG-AC-08: updates metadata, audits field names, rejects immutable fields, and archives", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const watched = await createTestKeyPair();
    const wallet = (
      await callAs(api, session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;

    const updated = await callAs(api, session, "PATCH", `/wallets/${wallet.id}`, {
      label: "Cold watch",
      category: "COLD_STORAGE",
      purpose: "Monitor the cold wallet",
      notes: "Line one\r\nLine two",
      tags: ["cold"],
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      label: "Cold watch",
      category: "COLD_STORAGE",
      purpose: "Monitor the cold wallet",
      notes: "Line one\nLine two",
      tags: ["cold"],
    });

    for (const field of [
      { address: watched.address },
      { cluster: "testnet" },
      { custodyType: "BROWSER_WALLET" },
    ]) {
      const response = await callAs(api, session, "PATCH", `/wallets/${wallet.id}`, field);
      expect(response.json().code).toBe("VALIDATION_FAILED");
    }

    const archived = await callAs(api, session, "PATCH", `/wallets/${wallet.id}`, { status: "archived" });
    expect(archived.json().data).toMatchObject({ status: "archived" });
    expect(archived.json().data.archivedAt).not.toBeNull();
    const restored = await callAs(api, session, "PATCH", `/wallets/${wallet.id}`, { status: "active" });
    expect(restored.json().data).toMatchObject({ status: "active", archivedAt: null });

    const audit = await migratorQuery<{ metadata: { fields: string[] } }>(
      "SELECT metadata FROM audit_events WHERE action = 'wallet.updated' ORDER BY occurred_at",
    );
    expect(audit.map((row) => row.metadata.fields)).toEqual([
      ["label", "purpose", "category", "notes", "tags"],
      ["status"],
      ["status"],
    ]);
    expect(JSON.stringify(audit)).not.toContain("Line one");
  });

  it("WRG-AC-09: assignments require organization.manage and an active member", async () => {
    api = await createTestApi();
    const admin = await operator(api, "admin");
    const member = await operator(api, "viewer");
    const outsider = await api.signIn();
    const watched = await createTestKeyPair();
    const wallet = (
      await callAs(api, admin, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;

    const members = await callAs(api, admin, "GET", "/organization/members");
    expect(members.json().data.map((entry: { userId: string }) => entry.userId)).toEqual(
      expect.arrayContaining([admin.userId, member.userId]),
    );

    const assigned = await callAs(api, admin, "POST", `/wallets/${wallet.id}/assignments`, {
      userId: member.userId,
      role: "CONTROLLER",
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data.assignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: member.userId, role: "CONTROLLER" })]),
    );
    const byMember = await callAs(api, member, "GET", `/wallets/${wallet.id}`);
    expect(byMember.json().data.myRoles).toEqual(["CONTROLLER"]);

    const notMember = await callAs(api, admin, "POST", `/wallets/${wallet.id}/assignments`, {
      userId: outsider.userId,
      role: "VIEWER",
    });
    expect(notMember.json().code).toBe("VALIDATION_FAILED");

    const denied = await callAs(api, member, "POST", `/wallets/${wallet.id}/assignments`, {
      userId: member.userId,
      role: "VIEWER",
    });
    expect(denied.statusCode).toBe(403);

    const removed = await callAs(
      api,
      admin,
      "DELETE",
      `/wallets/${wallet.id}/assignments/${member.userId}/CONTROLLER`,
    );
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.assignments).toHaveLength(1);

    const actions = await migratorQuery<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events WHERE action IN ('wallet.assigned', 'wallet.unassigned') ORDER BY occurred_at",
    );
    expect(actions).toEqual([
      { action: "wallet.assigned", metadata: { targetUserId: member.userId, role: "CONTROLLER" } },
      { action: "wallet.unassigned", metadata: { targetUserId: member.userId, role: "CONTROLLER" } },
    ]);
  });

  it("WRG-AC-10: authorization matrix over every registry route", async () => {
    api = await createTestApi({ rpcHandlers: { getMultipleAccounts: balances({}) } });
    const owner = await operator(api, "owner");
    const watched = await createTestKeyPair();
    const wallet = (
      await callAs(api, owner, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;
    const target = await createTestKeyPair();
    const routes = [
      { method: "GET", url: "/wallets", permission: "wallet.read" },
      { method: "GET", url: `/wallets/${wallet.id}`, permission: "wallet.read" },
      { method: "GET", url: `/wallets/${wallet.id}/transactions`, permission: "wallet.read" },
      {
        method: "POST",
        url: "/wallets/ownership-challenges",
        body: { address: target.address },
        permission: "wallet.create",
      },
      {
        method: "PATCH",
        url: `/wallets/${wallet.id}`,
        body: { label: "Renamed" },
        permission: "wallet.create",
      },
      { method: "GET", url: "/organization/members", permission: "organization.manage" },
      {
        method: "POST",
        url: `/wallets/${wallet.id}/assignments`,
        body: { userId: owner.userId, role: "VIEWER" },
        permission: "organization.manage",
      },
    ] as const;

    for (const [roleKey, role] of Object.entries(SYSTEM_ROLES)) {
      const session = await operator(api, roleKey);
      for (const route of routes) {
        const response = await callAs(
          api,
          session,
          route.method,
          route.url,
          "body" in route ? route.body : undefined,
        );
        const allowed = (role.permissions as readonly string[]).includes(route.permission);
        expect({ roleKey, url: route.url, status: response.statusCode }).toEqual({
          roleKey,
          url: route.url,
          status: allowed ? 200 : 403,
        });
      }
    }

    const anonymous = await callAs(api, null, "GET", "/wallets");
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await api.app.inject({
      method: "PATCH",
      url: `/api/v1/wallets/${wallet.id}`,
      cookies: owner.cookies,
      headers: { origin: "http://localhost:3000" },
      payload: { label: "x" },
    });
    expect(noCsrf.json().code).toBe("CSRF_TOKEN_INVALID");
    const denials = await migratorQuery("SELECT 1 FROM audit_events WHERE action = 'authorization.denied'");
    expect(denials.length).toBeGreaterThan(0);
  });

  it("WRG-AC-13: history lists indexed transactions newest first with cursor pages and coverage", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const watched = await createTestKeyPair();
    const wallet = (
      await callAs(api, session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;
    for (const [index, slot] of [100, 300, 200].entries()) {
      await migratorQuery(
        `INSERT INTO indexed_transactions (id, wallet_id, cluster, signature, slot, block_time, status, confirmation_status, memo, fee_lamports, sol_change_lamports, details_retrieved_at)
         VALUES (gen_random_uuid(), $1, 'devnet', $2, $3, to_timestamp($4), $5, 'finalized', NULL, $6, $7, $8)`,
        [
          wallet.id,
          `sig${slot}`,
          slot,
          1_700_000_000 + slot,
          index === 1 ? "failed" : "succeeded",
          index === 0 ? null : "5000",
          index === 0 ? null : "-1005000",
          index === 0 ? null : new Date(),
        ],
      );
    }
    await migratorQuery(
      "UPDATE wallet_sync_state SET indexed_count = 3, last_success_at = now(), backfill_complete = true WHERE wallet_id = $1",
      [wallet.id],
    );

    const first = await callAs(api, session, "GET", `/wallets/${wallet.id}/transactions?limit=2`);
    expect(first.statusCode).toBe(200);
    const page = first.json();
    expect(page.data.transactions.map((row: { signature: string }) => row.signature)).toEqual([
      "sig300",
      "sig200",
    ]);
    expect(page.data.transactions[0]).toMatchObject({
      slot: "300",
      status: "failed",
      feeLamports: "5000",
      solChangeLamports: "-1005000",
    });
    expect(page.data.sync).toMatchObject({ indexedCount: 3, backfillComplete: true });
    expect(page.data.sync.oldestIndexedBlockTime).toBe(new Date((1_700_000_000 + 100) * 1000).toISOString());
    expect(page.data.backfillCap).toBe(1000);

    const second = await callAs(
      api,
      session,
      "GET",
      `/wallets/${wallet.id}/transactions?limit=2&cursor=${page.meta.nextCursor as string}`,
    );
    expect(second.json().data.transactions).toEqual([
      expect.objectContaining({ signature: "sig100", feeLamports: null, solChangeLamports: null }),
    ]);
    expect(second.json().meta.nextCursor).toBeNull();
  });

  it("WRG-AC-14: manual sync is throttled per wallet and audited once", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const watched = await createTestKeyPair();
    const wallet = (
      await callAs(api, session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;

    const first = await callAs(api, session, "POST", `/wallets/${wallet.id}/sync`);
    expect(first.json().data).toEqual({ enqueued: true, retryAfterMs: null });
    const second = await callAs(api, session, "POST", `/wallets/${wallet.id}/sync`);
    expect(second.json().data.enqueued).toBe(false);
    expect(second.json().data.retryAfterMs).toBeGreaterThan(0);
    expect(second.json().data.retryAfterMs).toBeLessThanOrEqual(30_000);

    const audit = await migratorQuery("SELECT 1 FROM audit_events WHERE action = 'wallet.sync_requested'");
    expect(audit).toHaveLength(1);
  });

  it("LWG-AC-07: exports of local recovery material require wallet.export, local custody, and are audited", async () => {
    api = await createTestApi();
    const session = await operator(api);
    const viewer = await operator(api, "viewer");
    const local = await createTestKeyPair();
    const proof = await proveControl(api, session, local);
    const wallet = (
      await callAs(api, session, "POST", "/wallets", {
        custodyType: "LOCAL_ENCRYPTED",
        address: local.address,
        label: "Local key",
        category: "DEVELOPMENT",
        ownership: { challengeId: proof.challengeId, signature: proof.signature },
      })
    ).json().data;

    const exported = await callAs(api, session, "POST", `/wallets/${wallet.id}/exports`);
    expect(exported.statusCode).toBe(200);
    expect(exported.json().data.recordedAt).toEqual(expect.any(String));
    const audit = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'wallet.exported'",
    );
    expect(audit).toEqual([{ metadata: { address: local.address, format: "solana-cli-keypair" } }]);

    expect((await callAs(api, viewer, "POST", `/wallets/${wallet.id}/exports`)).statusCode).toBe(403);

    const watched = await createTestKeyPair();
    const watchOnly = (
      await callAs(api, session, "POST", "/wallets", {
        custodyType: "WATCH_ONLY",
        address: watched.address,
        label: "Watched",
        category: "RESEARCH",
      })
    ).json().data;
    const refused = await callAs(api, session, "POST", `/wallets/${watchOnly.id}/exports`);
    expect(refused.json().code).toBe("OPERATION_NOT_ALLOWED");
  });
});
