import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";
export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  /** Lightweight connectivity check used by readiness probes. */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export function createDatabase(url: string, options: { maxConnections?: number } = {}): DatabaseHandle {
  const client = postgres(url, {
    max: options.maxConnections ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  return {
    db,
    ping: async () => {
      await client`select 1`;
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";
export { COMMITTED_MIGRATIONS } from "./migration-journal";
