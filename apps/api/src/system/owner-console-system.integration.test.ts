import { integrationEnvironment } from "@sct/testing";
import { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";
import { callAs, createTestApi, migratorQuery, type TestApi } from "../../test/harness";

let api: TestApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const call = callAs;

async function ownerApi(options: Parameters<typeof createTestApi>[0] = {}) {
  const testApi = await createTestApi(options);
  const owner = await testApi.signIn();
  await testApi.grantRole(owner.userId, "owner");
  return { testApi, owner };
}

describe("owner console — system", () => {
  it("OWN-AC-12: runtime inspection shows configuration, process, PostgreSQL, and Redis facts without secrets", async () => {
    const { testApi, owner } = await ownerApi();
    api = testApi;
    const response = await call(api, owner, "GET", "/admin/system/runtime");
    expect(response.statusCode).toBe(200);
    const runtime = response.json().data;

    expect(runtime.configuration).toMatchObject({
      appEnv: "ci",
      cluster: "devnet",
      sessionIdleTimeoutSeconds: 1800,
      bootstrapOwnerConfigured: false,
      defaultMemberRole: null,
      openApiExposed: true,
    });
    expect(runtime.process.nodeVersion).toMatch(/^v24\./);
    expect(runtime.database.status).toBe("AVAILABLE");
    expect(runtime.database.value.migrations.pending).toEqual([]);
    expect(runtime.database.value.migrations.applied).toBe(runtime.database.value.migrations.committed);
    expect(runtime.database.value.tables.map((table: { name: string }) => table.name)).toEqual(
      expect.arrayContaining(["users", "sessions", "audit_events", "user_preferences", "platform_settings"]),
    );
    expect(runtime.redis).toMatchObject({ status: "AVAILABLE", value: { version: expect.any(String) } });

    const body = response.body;
    const secret = api.services.config.AUTH_SECRET;
    for (const forbidden of [secret, "change-me", "postgresql://", "redis://", "sct_app", "csrf"]) {
      expect({ forbidden, found: body.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
  });

  it("OWN-AC-13: re-verifies the cluster on demand and audits the outcome", async () => {
    const { testApi, owner } = await ownerApi();
    api = testApi;
    const verified = await call(api, owner, "POST", "/admin/system/cluster/verify");
    expect(verified.json().data).toMatchObject({
      cluster: "devnet",
      verified: true,
      solanaCoreVersion: "stub",
    });

    api.stub.setHandler("getGenesisHash", {
      kind: "result",
      result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    });
    const mismatch = await call(api, owner, "POST", "/admin/system/cluster/verify");
    expect(mismatch.json().data.verified).toBe(false);

    const events = await migratorQuery<{ result: string; metadata: Record<string, unknown> }>(
      "SELECT result, metadata FROM audit_events WHERE action = 'system.cluster_verification_requested' ORDER BY occurred_at",
    );
    expect(events).toEqual([
      { result: "success", metadata: { verified: true } },
      { result: "failure", metadata: { verified: false } },
    ]);
  });

  it("OWN-AC-14: lists provider health snapshots newest first, optionally by provider", async () => {
    const { testApi, owner } = await ownerApi();
    api = testApi;
    for (const [providerId, minutesAgo, status] of [
      ["solana-rpc-primary", 2, "HEALTHY"],
      ["solana-rpc-primary", 1, "DEGRADED"],
      ["other-provider", 0, "UNAVAILABLE"],
    ] as const) {
      await migratorQuery(
        `INSERT INTO provider_health_checks (id, provider_id, cluster, status, latency_p50_ms, error_rate, request_count, last_failure_reason, checked_at)
         VALUES (gen_random_uuid(), $1, 'devnet', $2, 120, 0.25, 4, 'timeout', now() - make_interval(mins => $3))`,
        [providerId, status, minutesAgo],
      );
    }
    const all = (await call(api, owner, "GET", "/admin/system/provider-history")).json().data;
    expect(all.map((row: { status: string }) => row.status)).toEqual(["UNAVAILABLE", "DEGRADED", "HEALTHY"]);
    expect(all[0]).toMatchObject({
      errorRate: 0.25,
      latencyP50Ms: 120,
      requestCount: 4,
      lastFailureReason: "timeout",
    });

    const filtered = (
      await call(api, owner, "GET", "/admin/system/provider-history?providerId=solana-rpc-primary&limit=1")
    ).json().data;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].status).toBe("DEGRADED");
  });

  it("OWN-AC-15: shows the provider-health queue and enqueues a probe on demand", async () => {
    const { testApi, owner } = await ownerApi();
    api = testApi;
    const before = (await call(api, owner, "GET", "/admin/jobs")).json().data.queues[0];
    expect(before).toMatchObject({ status: "AVAILABLE", value: { name: "system.provider-health" } });

    const run = await call(api, owner, "POST", "/admin/jobs/provider-health/run");
    expect(run.json().data).toEqual({ queue: "system.provider-health", jobId: expect.any(String) });

    const after = (await call(api, owner, "GET", "/admin/jobs")).json().data.queues[0];
    // No worker runs in this test, so the job waits.
    expect(after.value.counts.waiting).toBe(before.value.counts.waiting + 1);
    const [event] = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'system.job_enqueued'",
    );
    expect(event?.metadata).toEqual({ queue: "system.provider-health", jobName: "probe-solana-rpc" });
  });
});

describe("owner console — developer", () => {
  it("OWN-AC-16: the route catalog lists every route with its declared access", async () => {
    const { testApi, owner } = await ownerApi();
    api = testApi;
    const routes = (await call(api, owner, "GET", "/admin/developer/routes")).json().data as Array<{
      method: string;
      url: string;
      access: Record<string, string>;
    }>;
    const find = (method: string, url: string) =>
      routes.find((route) => route.method === method && route.url === url);
    expect(find("GET", "/api/v1/system/health")?.access).toEqual({ kind: "public" });
    expect(find("GET", "/api/v1/me/profile")?.access).toEqual({ kind: "session" });
    expect(find("GET", "/api/v1/audit/events")?.access).toEqual({
      kind: "permission",
      permission: "audit.read",
    });
    expect(find("GET", "/api/v1/admin/overview")?.access).toEqual({
      kind: "permission",
      permission: "platform.administer",
    });
    expect(routes.some((route) => route.method === "HEAD")).toBe(false);
  });

  it("OWN-AC-16: purges only the selected cache and audits it", async () => {
    const { testApi, owner } = await ownerApi();
    api = testApi;
    const redis = new Redis(integrationEnvironment.redisUrl);
    try {
      await redis.set("sct:wallets:overview:devnet:abc:balance", "{}");
      await redis.set("sct:wallets:overview:devnet:abc:tokens", "{}");
      await redis.set("sct:wallets:overview:last-success:devnet:abc:balance", "2026-10-01T00:00:00.000Z");
      await redis.set("sct:unrelated", "keep");

      const purged = await call(api, owner, "POST", "/admin/developer/cache/purge", {
        target: "wallet-overview",
      });
      expect(purged.json().data).toEqual({ target: "wallet-overview", keysDeleted: 2 });
      expect(await redis.exists("sct:wallets:overview:last-success:devnet:abc:balance")).toBe(1);
      expect(await redis.get("sct:unrelated")).toBe("keep");
    } finally {
      await redis.quit();
    }

    const permissions = await call(api, owner, "POST", "/admin/developer/cache/purge", {
      target: "permissions",
    });
    expect(permissions.json().data.target).toBe("permissions");
    const events = await migratorQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM audit_events WHERE action = 'system.cache_purged' ORDER BY occurred_at",
    );
    expect(events.map((event) => event.metadata.target)).toEqual(["wallet-overview", "permissions"]);
  });
});
