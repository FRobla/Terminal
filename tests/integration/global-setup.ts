import { runMigrations } from "@sct/database/scripts/migrate";
import { seedReferenceData } from "@sct/database/scripts/seed";
import { integrationEnvironment } from "@sct/testing";
import { Redis } from "ioredis";
import postgres from "postgres";

/**
 * Rebuilds the integration test database from the committed migrations (FND-AC-06)
 * and seeds reference data. Requires `pnpm infra:up`.
 */
export default async function setup(): Promise<void> {
  const sql = postgres(integrationEnvironment.migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql.unsafe(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT USAGE ON SCHEMA public TO sct_app;
    `);
  } catch (error) {
    throw new Error("Integration database is unavailable. Run `pnpm infra:up` first.", { cause: error });
  } finally {
    await sql.end({ timeout: 5 });
  }

  await runMigrations(integrationEnvironment.migrationDatabaseUrl);
  // Running twice proves migrations are idempotent.
  await runMigrations(integrationEnvironment.migrationDatabaseUrl);
  await seedReferenceData(integrationEnvironment.migrationDatabaseUrl);

  const redis = new Redis(integrationEnvironment.redisUrl);
  await redis.flushdb();
  await redis.quit();
}
