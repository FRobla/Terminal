import { ConfigurationError, loadApiEnvironment } from "@sct/config";
import { createDatabase } from "@sct/database";
import { createLogger, startTracing } from "@sct/observability";
import { Redis } from "ioredis";
import { buildServer } from "./server";
import { createApiServices } from "./services";

async function main(): Promise<void> {
  let env;
  try {
    env = loadApiEnvironment();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const tracing = await startTracing({
    serviceName: "sct-api",
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const logger = createLogger({
    service: "api",
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === "local" && env.NODE_ENV !== "production",
  });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const database = createDatabase(env.DATABASE_URL);

  const services = createApiServices(env, { redis, database, logger });
  const app = await buildServer(services, {
    authRateLimit: { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindowMs: 60_000 },
  });
  services.clusterVerification.start();
  services.fallbackClusterVerification?.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down API");
    services.clusterVerification.stop();
    services.fallbackClusterVerification?.stop();
    await app.close();
    await services.close();
    await Promise.allSettled([redis.quit(), database.close(), tracing.shutdown()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  logger.info({ cluster: env.SOLANA_CLUSTER, port: env.API_PORT }, "API listening");
}

main().catch((error: unknown) => {
  console.error("API failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
