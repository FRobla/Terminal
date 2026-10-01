import journal from "../migrations/meta/_journal.json" with { type: "json" };

/**
 * Migrations committed with this build. Drizzle records each applied migration with the
 * journal's `when` timestamp as `created_at`, which links applied rows back to their tags.
 */
export const COMMITTED_MIGRATIONS: ReadonlyArray<{ tag: string; createdAtMillis: number }> =
  journal.entries.map((entry) => ({ tag: entry.tag, createdAtMillis: entry.when }));
