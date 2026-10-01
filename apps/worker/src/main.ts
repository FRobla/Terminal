import { ConfigurationError, loadWorkerEnvironment } from "@sct/config";
import { createDatabase } from "@sct/database";
import { createLogger, startTracing } from "@sct/observability";
import { ConcurrencyLimiter, RedisProviderHealthStore, RedisTokenBucketLimiter } from "@sct/providers";
import {
  ClusterIdentityReader,
  PRIMARY_RPC_PROVIDER_ID,
  SolanaRpcClient,
  solanaRpcProviderDescriptor,
} from "@sct/solana";
import { Redis } from "ioredis";
import { startQueues } from "./queues";
import { ProviderHealthProbe } from "./system/provider-health-probe";
import { ProviderHealthSnapshotRepository } from "./system/provider-health-snapshot-repository";

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
  const rpc = new SolanaRpcClient(descriptor, {
    limiter: new RedisTokenBucketLimiter(redis),
    health,
    concurrency: new ConcurrencyLimiter(2),
    onInternalError: (error) => logger.warn({ err: error }, "Provider health bookkeeping failed"),
  });

  const queues = await startQueues({
    connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
    logger,
    providerHealthProbe: new ProviderHealthProbe(
      { cluster: env.SOLANA_CLUSTER, localnetGenesisHash: env.SOLANA_EXPECTED_GENESIS_HASH },
      {
        rpc,
        identity: new ClusterIdentityReader(rpc),
        health,
        snapshots: new ProviderHealthSnapshotRepository(database.db),
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
