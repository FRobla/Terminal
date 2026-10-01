import { Writable } from "node:stream";
import { createDatabase } from "@sct/database";
import { createLogger } from "@sct/observability";
import { ConcurrencyLimiter, RedisProviderHealthStore, RedisTokenBucketLimiter } from "@sct/providers";
import {
  ClusterIdentityReader,
  SignatureHistoryReader,
  SolanaRpcClient,
  solanaRpcProviderDescriptor,
  TransactionDetailsReader,
} from "@sct/solana";
import { integrationEnvironment, startStubRpcServer, type StubRpcServer } from "@sct/testing";
import { KNOWN_GENESIS_HASHES } from "@sct/network";
import { Redis } from "ioredis";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startQueues } from "./queues";
import { ProviderHealthProbe } from "./system/provider-health-probe";
import { ProviderHealthSnapshotRepository } from "./system/provider-health-snapshot-repository";
import type { TransactionSweeps } from "./transactions/transaction-sweeps";
import { WalletSyncJob } from "./wallets/wallet-sync-job";
import { WalletSyncRepository } from "./wallets/wallet-sync-repository";

let stub: StubRpcServer;
let redis: Redis;
let database: ReturnType<typeof createDatabase>;
const logger = createLogger({
  service: "worker-test",
  level: "error",
  destination: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
});

function buildClient(providerId: string) {
  return new SolanaRpcClient(
    solanaRpcProviderDescriptor({
      id: providerId,
      displayName: "Stub RPC",
      cluster: "devnet",
      endpoint: stub.url,
    }),
    {
      limiter: new RedisTokenBucketLimiter(redis),
      health: new RedisProviderHealthStore(redis),
      concurrency: new ConcurrencyLimiter(1),
    },
  );
}

function buildProbe(providerId: string) {
  const health = new RedisProviderHealthStore(redis);
  const rpc = new SolanaRpcClient(
    solanaRpcProviderDescriptor({
      id: providerId,
      displayName: "Stub RPC",
      cluster: "devnet",
      endpoint: stub.url,
    }),
    { limiter: new RedisTokenBucketLimiter(redis), health, concurrency: new ConcurrencyLimiter(1) },
  );
  return new ProviderHealthProbe(
    { cluster: "devnet" },
    {
      rpc,
      identity: new ClusterIdentityReader(rpc),
      health,
      snapshots: new ProviderHealthSnapshotRepository(database.db),
      logger,
    },
  );
}

beforeAll(async () => {
  stub = await startStubRpcServer();
  redis = new Redis(integrationEnvironment.redisUrl);
  database = createDatabase(integrationEnvironment.applicationDatabaseUrl, { maxConnections: 2 });
});

afterAll(async () => {
  await stub.close();
  await redis.quit();
  await database.close();
});

describe("provider health probe", () => {
  it("PH-AC-03: probes within budget, verifies genesis on the first run, and persists a snapshot", async () => {
    stub.reset();
    const probe = buildProbe("worker-probe-test");
    const health = await probe.run();
    expect(health.status).toBe("HEALTHY");
    expect(stub.calls.get("getSlot")).toBe(1);
    expect(stub.calls.get("getGenesisHash")).toBe(1);

    await probe.run();
    expect(stub.calls.get("getSlot")).toBe(2);
    expect(stub.calls.get("getGenesisHash")).toBe(1);

    const sql = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
    const rows = await sql`select status from provider_health_checks where provider_id = 'worker-probe-test'`;
    await sql.end();
    expect(rows).toHaveLength(2);
  });

  it("NET-AC-03: a Mainnet genesis hash marks the provider UNAVAILABLE", async () => {
    stub.reset();
    stub.setHandler("getGenesisHash", { kind: "result", result: KNOWN_GENESIS_HASHES["mainnet-beta"] });
    const health = await buildProbe("worker-mainnet-test").run();
    expect(health.status).toBe("UNAVAILABLE");
    expect(health.lastFailureReason).toContain("mainnet-beta");
  });
});

describe("worker lifecycle", () => {
  it("FND-AC-09: queues start, run the scheduled probe, and close cleanly", async () => {
    stub.reset();
    const queues = await startQueues({
      connection: { url: integrationEnvironment.redisUrl, maxRetriesPerRequest: null },
      logger,
      providerHealthProbes: [buildProbe("worker-lifecycle-test")],
      transactionSweeps: {
        confirm: async () => ({ checked: 0, moved: 0 }),
        reconcile: async () => ({ checked: 0, moved: 0 }),
      } as unknown as TransactionSweeps,
      walletSync: (scheduler) =>
        new WalletSyncJob(
          { cluster: "devnet" },
          {
            store: new WalletSyncRepository(database.db),
            readers: {
              signatures: new SignatureHistoryReader(buildClient("worker-lifecycle-sync")),
              details: new TransactionDetailsReader(buildClient("worker-lifecycle-sync")),
            },
            scheduler,
            logger,
          },
        ),
    });
    await expect.poll(() => stub.calls.get("getSlot") ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(queues.close()).resolves.toBeUndefined();
  });
});
