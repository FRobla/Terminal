/**
 * Connection settings for integration tests against the local Docker services
 * (`pnpm infra:up`). Tests use a dedicated database and Redis logical database.
 */
export const integrationEnvironment = {
  migrationDatabaseUrl:
    process.env.TEST_DATABASE_MIGRATION_URL ??
    "postgresql://sct_migrator:change-me@localhost:5432/solana_terminal_test",
  applicationDatabaseUrl:
    process.env.TEST_DATABASE_URL ?? "postgresql://sct_app:change-me@localhost:5432/solana_terminal_test",
  redisUrl: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1",
};
