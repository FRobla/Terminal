import { balanceResult, tokenAccountsResult } from "@sct/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApi, migratorQuery, TEST_ORIGIN, type TestApi } from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const MINT_A = "So11111111111111111111111111111111111111112";
const MINT_B = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TOKEN_ACCOUNT_A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TOKEN_ACCOUNT_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

async function viewerSession(testApi: TestApi) {
  const session = await testApi.signIn();
  await testApi.grantRole(session.userId, "viewer");
  return session;
}

function overviewUrl(address: string, query = "") {
  return `/api/v1/wallets/${address}/overview${query}`;
}

function stubHealthyWallet(testApi: TestApi, owner: string) {
  testApi.stub.setHandler("getBalance", { kind: "result", result: balanceResult(1_500_000_000n, 4242) });
  testApi.stub.setHandler("getTokenAccountsByOwner", (params) => {
    const filter = params[1] as { programId: string };
    const isToken2022 = filter.programId.startsWith("TokenzQd");
    return {
      kind: "result",
      result: tokenAccountsResult(
        isToken2022
          ? [
              {
                pubkey: TOKEN_ACCOUNT_B,
                mint: MINT_B,
                owner,
                amount: "1",
                decimals: 0,
                program: "spl-token-2022",
                state: "frozen",
              },
            ]
          : [
              {
                pubkey: TOKEN_ACCOUNT_A,
                mint: MINT_A,
                owner,
                amount: "123456789",
                decimals: 6,
                program: "spl-token",
              },
            ],
        4240,
      ),
    };
  });
  testApi.stub.setHandler("getSignaturesForAddress", {
    kind: "result",
    result: [
      {
        signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
        slot: 4241,
        blockTime: 1790000000,
        err: null,
        memo: "hello\u202Eevil\u0000<script>",
        confirmationStatus: "finalized",
      },
      {
        signature: "2nBhEBYYvfaAe16UMNqRHre4YNSskvuYgx3M6E4JP1oDYvZEJHvoPzyUidNgNX5r9sTyN1J9UxtbCXy2rqYcuyuv",
        slot: 4200,
        blockTime: null,
        err: { InstructionError: [0, "Custom"] },
        memo: null,
        confirmationStatus: "confirmed",
      },
    ],
  });
}

describe("GET /wallets/:address/overview", () => {
  it("WO-AC-03/04/05/06: returns real-shaped balance, both token programs, and signatures with provenance", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);

    const response = await api.app.inject({
      method: "GET",
      url: overviewUrl(session.identity.address),
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const overview = response.json().data;

    expect(overview.solBalance).toMatchObject({
      status: "AVAILABLE",
      value: { lamports: "1500000000", decimals: 9, uiAmount: "1.5" },
      provenance: {
        source: "solana-rpc-devnet",
        method: "getBalance",
        network: "devnet",
        commitment: "confirmed",
        slot: "4242",
        confidence: "AUTHORITATIVE",
        fallbackUsed: false,
      },
    });
    expect(overview.solBalance.provenance.requestId).toBe(response.headers["x-request-id"]);
    expect(overview.solBalance.provenance.endpoint).toBe(api.stub.url);

    expect(overview.tokenAccounts.status).toBe("AVAILABLE");
    expect(overview.tokenAccounts.value).toEqual([
      expect.objectContaining({
        mint: MINT_A,
        tokenProgram: "spl-token",
        amount: "123456789",
        uiAmount: "123.456789",
      }),
      expect.objectContaining({
        mint: MINT_B,
        tokenProgram: "token-2022",
        amount: "1",
        uiAmount: "1",
        state: "frozen",
      }),
    ]);
    expect(overview.tokenAccounts.provenance.slot).toBe("4240");

    const [first, second] = overview.recentTransactions.value;
    expect(first).toMatchObject({ slot: "4241", status: "succeeded", confirmationStatus: "finalized" });
    expect(first.blockTime).toBe(new Date(1790000000 * 1000).toISOString());
    expect(first.explorerUrl).toContain("?cluster=devnet");
    expect(second).toMatchObject({ status: "failed", blockTime: null });
    expect(overview.explorerUrl).toBe(
      `https://explorer.solana.com/address/${session.identity.address}?cluster=devnet`,
    );
  });

  it("WO-AC-17: strips control and bidirectional override characters from memos", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);
    const overview = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    expect(overview.recentTransactions.value[0].memo).toBe("helloevil<script>");
  });

  it("WO-AC-08: validates the address, the session, and the permission", async () => {
    api = await createTestApi();
    const unauthenticated = await api.app.inject({
      method: "GET",
      url: overviewUrl("11111111111111111111111111111111"),
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json().code).toBe("UNAUTHENTICATED");

    const noMembership = await api.signIn();
    const forbidden = await api.app.inject({
      method: "GET",
      url: overviewUrl(noMembership.identity.address),
      cookies: noMembership.cookies,
    });
    expect(forbidden.statusCode).toBe(403);

    const session = await viewerSession(api);
    for (const invalid of ["not-an-address", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl", "1111"]) {
      const response = await api.app.inject({
        method: "GET",
        url: overviewUrl(invalid),
        cookies: session.cookies,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("WALLET_ADDRESS_INVALID");
    }
    const badLimit = await api.app.inject({
      method: "GET",
      url: overviewUrl(session.identity.address, "?signaturesLimit=500"),
      cookies: session.cookies,
    });
    expect(badLimit.statusCode).toBe(400);
    expect(badLimit.json().code).toBe("VALIDATION_FAILED");
  });

  it("WO-AC-09/10: empty token accounts and history are empty lists, not placeholders", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    api.stub.setHandler("getBalance", { kind: "result", result: balanceResult(0) });
    api.stub.setHandler("getTokenAccountsByOwner", { kind: "result", result: tokenAccountsResult([]) });
    api.stub.setHandler("getSignaturesForAddress", { kind: "result", result: [] });
    const overview = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    expect(overview.solBalance.value.lamports).toBe("0");
    expect(overview.tokenAccounts).toMatchObject({ status: "AVAILABLE", value: [] });
    expect(overview.recentTransactions).toMatchObject({ status: "AVAILABLE", value: [] });
  });

  it("WO-AC-11: an RPC outage yields UNAVAILABLE sections with retry state and degrades provider health", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    for (const method of ["getBalance", "getTokenAccountsByOwner", "getSignaturesForAddress"]) {
      api.stub.setHandler(method, { kind: "http-error", status: 503 });
    }
    const response = await api.app.inject({
      method: "GET",
      url: overviewUrl(session.identity.address),
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    const overview = response.json().data;
    expect(overview.solBalance).toMatchObject({
      status: "UNAVAILABLE",
      value: null,
      provenance: null,
      unavailable: {
        reason: "RPC_UNAVAILABLE",
        source: "solana-rpc-devnet",
        lastSuccessfulRetrievalAt: null,
        retry: { retryable: true, attempts: 3 },
      },
    });
    expect(api.stub.calls.get("getBalance")).toBe(3);

    await api.grantRole(session.userId, "auditor");
    const health = (
      await api.app.inject({ method: "GET", url: "/api/v1/system/providers", cookies: session.cookies })
    ).json().data[0];
    expect(["UNAVAILABLE", "DEGRADED"]).toContain(health.status);
    expect(health.lastFailureReason).toContain("HTTP 503");
  });

  it("WO-AC-11: reports the last successful retrieval after a later failure", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);
    const first = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    await api.services.redis.del(`sct:wallets:overview:devnet:${session.identity.address}:sol-balance`);
    api.stub.setHandler("getBalance", { kind: "http-error", status: 500 });
    const second = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    expect(second.solBalance.status).toBe("UNAVAILABLE");
    expect(second.solBalance.unavailable.lastSuccessfulRetrievalAt).toBe(
      first.solBalance.provenance.retrievedAt,
    );
  });

  it("WO-AC-12: a 429 is not retried, is reported as RPC_RATE_LIMITED, and marks the provider RATE_LIMITED", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);
    api.stub.setHandler("getBalance", { kind: "http-error", status: 429, headers: { "retry-after": "7" } });
    const overview = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    expect(overview.solBalance.unavailable).toMatchObject({
      reason: "RPC_RATE_LIMITED",
      retry: { retryable: true, retryAfterMs: 7000, attempts: 1 },
    });
    expect(api.stub.calls.get("getBalance")).toBe(1);
    expect(overview.tokenAccounts.status).toBe("AVAILABLE");

    await api.grantRole(session.userId, "auditor");
    const health = (
      await api.app.inject({ method: "GET", url: "/api/v1/system/providers", cookies: session.cookies })
    ).json().data[0];
    expect(health.status).toBe("RATE_LIMITED");
  });

  it("WO-AC-13: a failed Token-2022 query makes the whole token section unavailable while the balance stays available", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);
    api.stub.setHandler("getTokenAccountsByOwner", (params) => {
      const filter = params[1] as { programId: string };
      return filter.programId.startsWith("TokenzQd")
        ? { kind: "rpc-error", code: -32602, message: "Invalid params" }
        : { kind: "result", result: tokenAccountsResult([]) };
    });
    const response = await api.app.inject({
      method: "GET",
      url: overviewUrl(session.identity.address),
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    const overview = response.json().data;
    expect(overview.solBalance.status).toBe("AVAILABLE");
    expect(overview.tokenAccounts).toMatchObject({ status: "UNAVAILABLE", value: null });
    expect(overview.tokenAccounts.unavailable.retry.retryable).toBe(false);
  });

  it("returns RPC_INVALID_RESPONSE when the RPC payload fails validation", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);
    api.stub.setHandler("getBalance", { kind: "result", result: { value: "not a number" } });
    const overview = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    expect(overview.solBalance.unavailable.reason).toBe("RPC_INVALID_RESPONSE");
  });

  it("WO-AC-16: repeated requests within 10 s are served from cache with the original retrieval time", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    stubHealthyWallet(api, session.identity.address);
    const first = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    const second = (
      await api.app.inject({
        method: "GET",
        url: overviewUrl(session.identity.address),
        cookies: session.cookies,
      })
    ).json().data;
    expect(api.stub.calls.get("getBalance")).toBe(1);
    expect(second.solBalance.provenance.retrievedAt).toBe(first.solBalance.provenance.retrievedAt);
    expect(second.solBalance.provenance.confidence).toBe("CACHED");
  });
});

describe("POST /wallets/connections", () => {
  it("WO-AC-02: records wallet.connected with wallet name, chains, actor, organization, and request id", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    const response = await api.app.inject({
      method: "POST",
      url: "/api/v1/wallets/connections",
      cookies: session.cookies,
      headers: { origin: TEST_ORIGIN, "x-csrf-token": session.csrfToken },
      payload: {
        address: session.identity.address,
        walletName: "Test Wallet",
        walletChains: ["solana:devnet"],
      },
    });
    expect(response.json().data).toMatchObject({ accepted: true, reason: null });
    const [event] = await migratorQuery<Record<string, unknown>>(
      "SELECT action, actor_id, organization_id, request_id, cluster, metadata FROM audit_events WHERE action = 'wallet.connected'",
    );
    expect(event).toMatchObject({
      actor_id: session.userId,
      request_id: response.headers["x-request-id"],
      cluster: "devnet",
      metadata: {
        address: session.identity.address,
        walletName: "Test Wallet",
        walletChains: ["solana:devnet"],
      },
    });
    expect(event?.organization_id).not.toBeNull();
  });

  it("WO-AC-15: rejects a wallet account without solana:devnet and audits the rejection", async () => {
    api = await createTestApi();
    const session = await viewerSession(api);
    const response = await api.app.inject({
      method: "POST",
      url: "/api/v1/wallets/connections",
      cookies: session.cookies,
      headers: { origin: TEST_ORIGIN, "x-csrf-token": session.csrfToken },
      payload: {
        address: session.identity.address,
        walletName: "Mainnet Wallet",
        walletChains: ["solana:mainnet"],
      },
    });
    expect(response.json().data).toMatchObject({ accepted: false, reason: "CLUSTER_MISMATCH" });
    const events = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'wallet.connection_rejected'",
    );
    expect(events[0]?.metadata.reason).toBe("CLUSTER_MISMATCH");
  });
});
