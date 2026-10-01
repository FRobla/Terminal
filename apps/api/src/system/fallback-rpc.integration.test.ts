import { balanceResult } from "@sct/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApi, type TestApi } from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const TESTNET_GENESIS_HASH = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

async function overview(testApi: TestApi) {
  const session = await testApi.signIn();
  await testApi.grantRole(session.userId, "viewer");
  const response = await testApi.app.inject({
    method: "GET",
    url: `/api/v1/wallets/${session.identity.address}/overview`,
    cookies: session.cookies,
  });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

const healthyFallback = {
  getBalance: { kind: "result" as const, result: balanceResult(42n, 900) },
  getTokenAccountsByOwner: { kind: "result" as const, result: { context: { slot: 900 }, value: [] } },
  getSignaturesForAddress: { kind: "result" as const, result: [] },
};

describe("Fallback RPC (SPEC-006 amendment)", () => {
  it("PH-AC-07: a failing primary is served by the verified fallback with fallbackUsed provenance", async () => {
    api = await createTestApi({
      rpcHandlers: { getBalance: { kind: "http-error", status: 503 } },
      fallbackRpcHandlers: healthyFallback,
    });
    const data = await overview(api);
    expect(data.solBalance).toMatchObject({
      status: "AVAILABLE",
      value: { lamports: "42" },
      provenance: { provider: "solana-fallback-rpc", fallbackUsed: true, slot: "900" },
    });
    expect(data.solBalance.provenance.endpoint).toBe(api.fallbackStub!.url);
    expect(api.stub.calls.get("getBalance")).toBe(3);
    expect(api.fallbackStub!.calls.get("getBalance")).toBe(1);
  });

  it("PH-AC-07: JSON-RPC error answers are definitive and never sent to the fallback", async () => {
    api = await createTestApi({
      rpcHandlers: { getBalance: { kind: "rpc-error", code: -32602, message: "Invalid params" } },
      fallbackRpcHandlers: healthyFallback,
    });
    const data = await overview(api);
    expect(data.solBalance.status).toBe("UNAVAILABLE");
    expect(api.fallbackStub!.calls.get("getBalance") ?? 0).toBe(0);
  });

  it("PH-AC-08: a fallback serving another cluster is never used and reports the mismatch", async () => {
    api = await createTestApi({
      rpcHandlers: { getBalance: { kind: "http-error", status: 503 } },
      fallbackRpcHandlers: {
        ...healthyFallback,
        getGenesisHash: { kind: "result", result: TESTNET_GENESIS_HASH },
      },
    });
    expect(api.services.fallbackClusterVerification?.isVerified()).toBe(false);
    const data = await overview(api);
    expect(data.solBalance).toMatchObject({
      status: "UNAVAILABLE",
      unavailable: { reason: "RPC_UNAVAILABLE" },
    });
    expect(api.fallbackStub!.calls.get("getBalance") ?? 0).toBe(0);

    const session = await api.signIn();
    await api.grantRole(session.userId, "auditor");
    const providers = await api.app.inject({
      method: "GET",
      url: "/api/v1/system/providers",
      cookies: session.cookies,
    });
    const fallback = providers
      .json()
      .data.find((provider: { providerId: string }) => provider.providerId === "solana-fallback-rpc");
    expect(fallback).toMatchObject({ status: "UNAVAILABLE" });
    expect(fallback.lastFailureReason).toMatch(/genesis/i);
  });

  it("PH-AC-09: the fallback is listed in provider health and the owner console runtime with a redacted endpoint", async () => {
    api = await createTestApi({ fallbackRpcHandlers: healthyFallback });
    const session = await api.signIn();
    await api.grantRole(session.userId, "owner");
    const providers = await api.app.inject({
      method: "GET",
      url: "/api/v1/system/providers",
      cookies: session.cookies,
    });
    expect(providers.json().data.map((provider: { providerId: string }) => provider.providerId)).toEqual([
      "solana-public-rpc",
      "solana-fallback-rpc",
    ]);
    const runtime = await api.app.inject({
      method: "GET",
      url: "/api/v1/admin/system/runtime",
      cookies: session.cookies,
    });
    expect(runtime.json().data.configuration.rpcFallbackEndpoint).toEqual(expect.any(String));
  });

  it("PH-AC-09: without a fallback nothing changes", async () => {
    api = await createTestApi();
    expect(api.services.fallbackClusterVerification).toBeNull();
    const session = await api.signIn();
    await api.grantRole(session.userId, "owner");
    const providers = await api.app.inject({
      method: "GET",
      url: "/api/v1/system/providers",
      cookies: session.cookies,
    });
    expect(providers.json().data).toHaveLength(1);
    const runtime = await api.app.inject({
      method: "GET",
      url: "/api/v1/admin/system/runtime",
      cookies: session.cookies,
    });
    expect(runtime.json().data.configuration.rpcFallbackEndpoint).toBeNull();
  });
});
