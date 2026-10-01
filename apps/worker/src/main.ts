import { ConfigurationError, loadWorkerEnvironment } from "@sct/config";
import { createDatabase } from "@sct/database";
import { createLogger, startTracing } from "@sct/observability";
import { ConcurrencyLimiter, RedisProviderHealthStore, RedisTokenBucketLimiter } from "@sct/providers";
import {
  ClusterIdentityReader,
  FailoverRpcClient,
  FALLBACK_RPC_PROVIDER_ID,
  PRIMARY_RPC_PROVIDER_ID,
  SignatureHistoryReader,
  SolanaRpcClient,
  solanaRpcProviderDescriptor,
  TransactionChainReaders,
  TransactionDetailsReader,
  type RpcGateway,
} from "@sct/solana";
import { DrizzleAuditEventWriter, AuditLog } from "@sct/audit";
import { DrizzleUnitOfWork, TransactionRepository, TransactionTransitions } from "@sct/transactions";
import { TransactionSweeps } from "./transactions/transaction-sweeps";
import { Redis } from "ioredis";
import { startQueues } from "./queues";
import { ProviderHealthProbe } from "./system/provider-health-probe";
import { ProviderHealthSnapshotRepository } from "./system/provider-health-snapshot-repository";
import { WalletSyncJob } from "./wallets/wallet-sync-job";
import { WalletSyncRepository } from "./wallets/wallet-sync-repository";

const SHUTDOWN_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  let env;
  try {
    env = loadWorkerEnvironment();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const tracing = await startTracing({
    serviceName: "sct-worker",
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const logger = createLogger({
    service: "worker",
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === "local" && env.NODE_ENV !== "production",
  });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const database = createDatabase(env.DATABASE_URL, { maxConnections: 3 });
  const health = new RedisProviderHealthStore(redis);

  const descriptor = solanaRpcProviderDescriptor({
    id: PRIMARY_RPC_PROVIDER_ID,
    displayName: "Solana public RPC",
    cluster: env.SOLANA_CLUSTER,
    endpoint: env.SOLANA_RPC_URL,
  });
  const callDependencies = {
    limiter: new RedisTokenBucketLimiter(redis),
    health,
    concurrency: new ConcurrencyLimiter(2),
    onInternalError: (error: unknown) => logger.warn({ err: error }, "Provider health bookkeeping failed"),
  };
  const rpc = new SolanaRpcClient(descriptor, callDependencies);
  const snapshots = new ProviderHealthSnapshotRepository(database.db);
  const probeConfig = { cluster: env.SOLANA_CLUSTER, localnetGenesisHash: env.SOLANA_EXPECTED_GENESIS_HASH };
  const probes = [
    new ProviderHealthProbe(probeConfig, {
      rpc,
      identity: new ClusterIdentityReader(rpc),
      health,
      snapshots,
      logger,
    }),
  ];

  // SPEC-006 amendment: the fallback has its own budget and health, and is used only while verified.
  let gateway: RpcGateway = rpc;
  if (env.SOLANA_RPC_FALLBACK_URL) {
    const fallback = new SolanaRpcClient(
      solanaRpcProviderDescriptor({
        id: FALLBACK_RPC_PROVIDER_ID,
        displayName: "Solana fallback RPC",
        cluster: env.SOLANA_CLUSTER,
        endpoint: env.SOLANA_RPC_FALLBACK_URL,
      }),
      { ...callDependencies, concurrency: new ConcurrencyLimiter(2) },
    );
    const fallbackProbe = new ProviderHealthProbe(probeConfig, {
      rpc: fallback,
      identity: new ClusterIdentityReader(fallback),
      health,
      snapshots,
      logger,
    });
    probes.push(fallbackProbe);
    gateway = new FailoverRpcClient(rpc, fallback, () => fallbackProbe.isVerified());
  }

  const transactionStore = new TransactionRepository(database.db);
  const chainReaders = new TransactionChainReaders(gateway);
  const detailsReader = new TransactionDetailsReader(gateway);
  const transactionSweeps = new TransactionSweeps(
    { cluster: env.SOLANA_CLUSTER },
    {
      store: transactionStore,
      transitions: new TransactionTransitions(
        { cluster: env.SOLANA_CLUSTER },
        {
          unitOfWork: new DrizzleUnitOfWork(database.db),
          store: transactionStore,
          audit: new AuditLog(new DrizzleAuditEventWriter(database.db)),
        },
      ),
      chain: {
        signatureStatuses: (signatures) => chainReaders.signatureStatuses(signatures),
        blockHeight: () => chainReaders.blockHeight(),
        rebroadcast: (wire) => chainReaders.rebroadcast(wire),
        transaction: (signature, context) => detailsReader.read(signature, "finalized", context),
      },
      logger,
    },
  );

  const queues = await startQueues({
    transactionSweeps,
    connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    logger,
    providerHealthProbes: probes,
    walletSync: (scheduler) =>
      new WalletSyncJob(
        { cluster: env.SOLANA_CLUSTER },
        {
          store: new WalletSyncRepository(database.db),
          readers: {
            signatures: new SignatureHistoryReader(gateway),
            details: new TransactionDetailsReader(gateway),
          },
          scheduler,
          logger,
        },
      ),
  });
  logger.info({ cluster: env.SOLANA_CLUSTER }, "Worker started");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down worker");
    const forceExit = setTimeout(() => {
      logger.error("Worker shutdown timed out");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    await queues.close();
    await Promise.allSettled([redis.quit(), database.close(), tracing.shutdown()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("Worker failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
