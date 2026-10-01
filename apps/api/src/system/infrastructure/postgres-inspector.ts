import { COMMITTED_MIGRATIONS, sql, type Database } from "@sct/database";
import type { DatabaseFacts } from "@sct/validation";
import type { DatabaseInspector } from "../application/console-ports";

/**
 * Compares applied migrations with those committed in this build. Drizzle applies every
 * committed migration newer than the latest applied one, so those are pending.
 */
export function migrationStatus(
  appliedCreatedAtMillis: readonly number[],
  committed: ReadonlyArray<{ tag: string; createdAtMillis: number }>,
): DatabaseFacts["migrations"] {
  const latest = appliedCreatedAtMillis.length > 0 ? Math.max(...appliedCreatedAtMillis) : null;
  return {
    applied: appliedCreatedAtMillis.length,
    committed: committed.length,
    latestAppliedTag:
      latest === null ? null : (committed.find((entry) => entry.createdAtMillis === latest)?.tag ?? null),
    pending: committed
      .filter((entry) => latest === null || entry.createdAtMillis > latest)
      .map((entry) => entry.tag),
  };
}

/** PostgreSQL facts from catalogs readable by the application role (OWN-AC-12). */
export class PostgresInspector implements DatabaseInspector {
  constructor(private readonly db: Database) {}

  async inspect(): Promise<DatabaseFacts> {
    const [server] = await this.db.execute<{ version: string; size: string }>(
      sql`select current_setting('server_version') as version, pg_database_size(current_database())::text as size`,
    );
    const applied = await this.db.execute<{ created_at: string }>(
      sql`select created_at::text as created_at from drizzle.__drizzle_migrations`,
    );
    const tables = await this.db.execute<{ name: string; live_rows: string; total_bytes: string }>(
      sql`select relname as name, n_live_tup::text as live_rows, pg_total_relation_size(relid)::text as total_bytes
          from pg_stat_user_tables where schemaname = 'public' order by relname`,
    );
    if (!server) throw new Error("PostgreSQL returned no server facts");
    return {
      serverVersion: server.version,
      databaseSizeBytes: Number(server.size),
      migrations: migrationStatus(
        [...applied].map((row) => Number(row.created_at)),
        COMMITTED_MIGRATIONS,
      ),
      tables: [...tables].map((row) => ({
        name: row.name,
        liveRows: Number(row.live_rows),
        totalBytes: Number(row.total_bytes),
      })),
    };
  }
}
