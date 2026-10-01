import { KNOWN_GENESIS_HASHES } from "@sct/network";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApi, type TestApi } from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe("system routes", () => {
  it("FND-AC-02: readiness is 200 only when PostgreSQL, Redis, and the Solana cluster are healthy", async () => {
    api = await createTestApi();
    const response = await api.app.inject({ method: "GET", url: "/api/v1/system/readiness" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      checks: { database: { status: "ok" }, redis: { status: "ok" }, solanaCluster: { status: "ok" } },
    });
  });

  it("NET-AC-02: reports the verified Devnet genesis hash", async () => {
    api = await createTestApi();
    const response = await api.app.inject({ method: "GET", url: "/api/v1/system/network" });
    const body = response.json().data;
    expect(body.cluster).toBe("devnet");
    expect(body.networkLabel).toBe("SOLANA DEVNET");
    expect(body.verified).toBe(true);
    expect(body.observedGenesisHash).toBe(KNOWN_GENESIS_HASHES.devnet);
    expect(body.verifiedAt).not.toBeNull();
  });

  it("NET-AC-03: an RPC serving another cluster blocks readiness and Solana-dependent routes", async () => {
    api = await createTestApi({
      rpcHandlers: { getGenesisHash: { kind: "result", result: KNOWN_GENESIS_HASHES["mainnet-beta"] } },
    });
    const network = (await api.app.inject({ method: "GET", url: "/api/v1/system/network" })).json().data;
    expect(network.verified).toBe(false);
    expect(network.failureReason).toContain("mainnet-beta");
    expect(api.logLines.some((line) => line.includes("CRITICAL"))).toBe(true);

    const readiness = await api.app.inject({ method: "GET", url: "/api/v1/system/readiness" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json().checks.solanaCluster.status).toBe("failed");

    const session = await api.signIn();
    await api.grantRole(session.userId, "viewer");
    const overview = await api.app.inject({
      method: "GET",
      url: `/api/v1/wallets/${session.identity.address}/overview`,
      cookies: session.cookies,
    });
    expect(overview.statusCode).toBe(503);
    expect(overview.json().code).toBe("CLUSTER_VERIFICATION_FAILED");
  });

  it("readiness never exposes internal details when the RPC is unreachable", async () => {
    api = await createTestApi({ rpcHandlers: { getGenesisHash: { kind: "http-error", status: 503 } } });
    const response = await api.app.inject({ method: "GET", url: "/api/v1/system/readiness" });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("127.0.0.1");
  });

  it("PH-AC-04: provider health requires system.read and reports real call statistics", async () => {
    api = await createTestApi();
    const session = await api.signIn();
    await api.grantRole(session.userId, "viewer");
    const denied = await api.app.inject({
      method: "GET",
      url: "/api/v1/system/providers",
      cookies: session.cookies,
    });
    expect(denied.statusCode).toBe(403);

    await api.grantRole(session.userId, "operator");
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/system/providers",
      cookies: session.cookies,
    });
    expect(response.statusCode).toBe(200);
    const [rpc] = response.json().data;
    expect(rpc.providerId).toBe("solana-public-rpc");
    expect(rpc.status).toBe("HEALTHY");
    expect(rpc.requestCount).toBeGreaterThan(0);
    expect(rpc.latencyP50Ms).not.toBeNull();
  });

  it("FND-AC-04: writes one completion log line with correlation fields and echoes X-Request-Id", async () => {
    api = await createTestApi();
    api.logLines.length = 0;
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/system/health",
      headers: { "x-request-id": "test-request-0001" },
    });
    expect(response.headers["x-request-id"]).toBe("test-request-0001");
    const completions = api.logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "request completed");
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      requestId: "test-request-0001",
      operation: "GET /api/v1/system/health",
      result: "success",
    });
    expect(completions[0]?.traceId).toEqual(expect.any(String));
    expect(completions[0]?.durationMs).toEqual(expect.any(Number));
  });

  it("serves the OpenAPI document generated from the Zod contracts outside production", async () => {
    api = await createTestApi();
    const response = await api.app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const paths = Object.keys(response.json().paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/v1/wallets/{address}/overview",
        "/api/v1/auth/siws/verify",
        "/api/v1/system/network",
      ]),
    );
  });

  it("returns the standard error format for unknown routes and rejects malformed request ids", async () => {
    api = await createTestApi();
    const response = await api.app.inject({
      method: "GET",
      url: "/api/v1/nope",
      headers: { "x-request-id": "<script>" },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.requestId).not.toBe("<script>");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
