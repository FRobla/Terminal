import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies committed migrations with the migration role (DATABASE_MIGRATION_URL).
 * Re-running is a no-op (FND-AC-06).
 */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error("DATABASE_MIGRATION_URL is required to run migrations.");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.warn("Migrations applied."))
    .catch((error: unknown) => {
      console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
      process.exit(1);
    });
}
