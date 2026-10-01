import { Writable } from "node:stream";
import { createDatabase } from "@sct/database";
import { createLogger } from "@sct/observability";
import { ConcurrencyLimiter, RedisProviderHealthStore, RedisTokenBucketLimiter } from "@sct/providers";
import {
  SignatureHistoryReader,
  SolanaRpcClient,
  solanaRpcProviderDescriptor,
  TransactionDetailsReader,
} from "@sct/solana";
import {
  createTestKeyPair,
  integrationEnvironment,
  startStubRpcServer,
  type StubRpcServer,
} from "@sct/testing";
import { Redis } from "ioredis";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BACKFILL_CAP, WalletSyncJob } from "./wallet-sync-job";
import { WalletSyncRepository } from "./wallet-sync-repository";

let stub: StubRpcServer;
let redis: Redis;
let database: ReturnType<typeof createDatabase>;
let admin: postgres.Sql;
const logger = createLogger({
  service: "worker-test",
  level: "error",
  destination: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
});

/** A synthetic history: signature `sig<n>` at slot n, newest (highest n) first. */
function history(total: number) {
  return Array.from({ length: total }, (_, index) => total - index).map((n) => ({
    signature: `sig${n}`,
    slot: n,
    blockTime: 1_790_000_000 + n,
    err: n % 7 === 0 ? { InstructionError: [0, "Custom"] } : null,
    memo: null,
    confirmationStatus: "finalized",
  }));
}

function serveHistory(entries: ReturnType<typeof history>) {
  stub.setHandler("getSignaturesForAddress", (params) => {
    const options = (params[1] ?? {}) as { limit: number; before?: string; until?: string };
    let start = 0;
    if (options.before) start = entries.findIndex((entry) => entry.signature === options.before) + 1;
    let page = entries.slice(start);
    if (options.until) {
      const stop = page.findIndex((entry) => entry.signature === options.until);
      if (stop >= 0) page = page.slice(0, stop);
    }
    return { kind: "result", result: page.slice(0, options.limit) };
  });
}

function serveDetails(walletAddress: string) {
  stub.setHandler("getTransaction", (params) => {
    const signature = params[0] as string;
    const n = Number(signature.slice(3));
    return {
      kind: "result",
      result: {
        slot: n,
        blockTime: 1_790_000_000 + n,
        meta: {
          fee: 5000,
          preBalances: [10_000_000, 0],
          postBalances: [10_000_000 - 5000 - n, n],
          err: null,
        },
        transaction: { message: { accountKeys: [walletAddress, "11111111111111111111111111111111"] } },
      },
    };
  });
}

let walletId: string;
let walletAddress: string;
let userId: string;

function buildJob(enqueued: string[] = []) {
  const client = new SolanaRpcClient(
    {
      ...solanaRpcProviderDescriptor({
        id: "wallet-sync-test",
        displayName: "Stub",
        cluster: "devnet",
        endpoint: stub.url,
      }),
      // The synthetic history needs far more calls than the public Devnet budget allows per window.
      budget: {
        requestsPerWindow: 10_000,
        windowMs: 10_000,
        perMethodRequestsPerWindow: 10_000,
        maxConcurrency: 1,
      },
    },
    {
      limiter: new RedisTokenBucketLimiter(redis),
      health: new RedisProviderHealthStore(redis),
      concurrency: new ConcurrencyLimiter(1),
      sleep: async () => undefined,
    },
  );
  return new WalletSyncJob(
    { cluster: "devnet" },
    {
      store: new WalletSyncRepository(database.db),
      readers: {
        signatures: new SignatureHistoryReader(client),
        details: new TransactionDetailsReader(client),
      },
      scheduler: { enqueue: async (_walletId, jobId) => void enqueued.push(jobId) },
      logger,
    },
  );
}

async function syncState() {
  const [row] = await admin`SELECT * FROM wallet_sync_state WHERE wallet_id = ${walletId}`;
  return row as Record<string, unknown>;
}

beforeAll(async () => {
  stub = await startStubRpcServer();
  redis = new Redis(integrationEnvironment.redisUrl);
  database = createDatabase(integrationEnvironment.applicationDatabaseUrl, { maxConnections: 2 });
  admin = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
});

beforeEach(async () => {
  stub.reset();
  await redis.flushdb();
  walletAddress = (await createTestKeyPair()).address;
  const [user] = await admin`INSERT INTO users (id) VALUES (gen_random_uuid()) RETURNING id`;
  userId = user!.id as string;
  const [wallet] = await admin`
    INSERT INTO managed_wallets (id, organization_id, address, cluster, label, category, custody_type, created_by_user_id)
    SELECT gen_random_uuid(), id, ${walletAddress}, 'devnet', 'Sync test', 'RESEARCH', 'WATCH_ONLY', ${userId}
    FROM organizations WHERE slug = 'default' RETURNING id`;
  walletId = wallet!.id as string;
  await admin`INSERT INTO wallet_sync_state (wallet_id) VALUES (${walletId})`;
});

afterEach(async () => {
  await admin`DELETE FROM indexed_transactions WHERE wallet_id = ${walletId}`;
  await admin`DELETE FROM wallet_sync_state WHERE wallet_id = ${walletId}`;
  await admin`DELETE FROM managed_wallets WHERE id = ${walletId}`;
  await admin`DELETE FROM users WHERE id = ${userId}`;
});

afterAll(async () => {
  await stub.close();
  await redis.quit();
  await database.close();
  await admin.end({ timeout: 5 });
});

describe("Wallet sync job (SPEC-009 §4.8)", () => {
  it("WRG-AC-11: indexes new signatures, backfills to the cap, fills details, and never duplicates", async () => {
    const entries = history(1250);
    serveHistory(entries);
    serveDetails(walletAddress);
    const job = buildJob();

    const first = await job.syncWallet(walletId, { requestId: "test" });
    // First run: 500 new signatures (cap per run), then one backfill page.
    expect(first).toEqual({ indexed: 600, details: 10 });
    let state = await syncState();
    expect(state).toMatchObject({
      newest_signature: "sig1250",
      oldest_signature: "sig651",
      backfill_complete: false,
      indexed_count: 600,
    });
    expect(state.last_success_at).not.toBeNull();

    const [detailed] = await admin`
      SELECT status, fee_lamports, sol_change_lamports FROM indexed_transactions
      WHERE wallet_id = ${walletId} AND signature = 'sig1250'`;
    expect(detailed).toEqual({ status: "succeeded", fee_lamports: "5000", sol_change_lamports: "-6250" });
    const [failed] = await admin`
      SELECT status FROM indexed_transactions WHERE wallet_id = ${walletId} AND signature = 'sig1246'`;
    expect(failed?.status).toBe("failed");

    for (let run = 0; run < 5; run += 1) await job.syncWallet(walletId, { requestId: "test" });
    state = await syncState();
    expect(state).toMatchObject({ indexed_count: BACKFILL_CAP, backfill_complete: true });

    // New activity is picked up incrementally, without duplicates.
    const grown = history(1253);
    serveHistory(grown);
    await job.syncWallet(walletId, { requestId: "test" });
    state = await syncState();
    expect(state).toMatchObject({ newest_signature: "sig1253", indexed_count: BACKFILL_CAP + 3 });
    const [duplicates] = await admin`
      SELECT count(*)::int AS n FROM (
        SELECT signature FROM indexed_transactions WHERE wallet_id = ${walletId} GROUP BY signature HAVING count(*) > 1
      ) d`;
    expect(duplicates?.n).toBe(0);
  });

  it("WRG-AC-11: a short history completes the backfill on the first run", async () => {
    serveHistory(history(3));
    serveDetails(walletAddress);
    await buildJob().syncWallet(walletId, { requestId: "test" });
    expect(await syncState()).toMatchObject({
      indexed_count: 3,
      backfill_complete: true,
      newest_signature: "sig3",
    });
  });

  it("WRG-AC-12: an RPC failure records the reason and keeps indexed rows", async () => {
    serveHistory(history(3));
    serveDetails(walletAddress);
    const job = buildJob();
    await job.syncWallet(walletId, { requestId: "test" });

    stub.setHandler("getSignaturesForAddress", { kind: "http-error", status: 503 });
    await expect(job.syncWallet(walletId, { requestId: "test" })).rejects.toThrow();
    const state = await syncState();
    expect(state.last_failure_reason).toBe("RPC UNAVAILABLE");
    expect((state.last_failure_at as Date).getTime()).toBeGreaterThanOrEqual(
      (state.last_success_at as Date).getTime(),
    );
    const [rows] =
      await admin`SELECT count(*)::int AS n FROM indexed_transactions WHERE wallet_id = ${walletId}`;
    expect(rows?.n).toBe(3);
  });

  it("WRG-AC-11: the sweep enqueues deterministic jobs for active wallets and skips archived ones", async () => {
    const enqueued: string[] = [];
    const job = buildJob(enqueued);
    await job.sweep();
    expect(enqueued.some((id) => id.startsWith(`sync-${walletId}-`))).toBe(true);

    await admin`UPDATE managed_wallets SET status = 'archived' WHERE id = ${walletId}`;
    enqueued.length = 0;
    await job.sweep();
    expect(enqueued.some((id) => id.startsWith(`sync-${walletId}-`))).toBe(false);
    expect(await job.syncWallet(walletId, { requestId: "test" })).toBeNull();
  });
});
