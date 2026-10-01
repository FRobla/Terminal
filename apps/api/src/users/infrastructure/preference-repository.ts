import { eq, schema, type Database } from "@sct/database";
import type { PreferenceStore, StoredPreferences } from "../application/ports";

export class PreferenceRepository implements PreferenceStore {
  constructor(private readonly db: Database) {}

  async load(userId: string): Promise<StoredPreferences | null> {
    const [row] = await this.db
      .select({
        schemaVersion: schema.userPreferences.schemaVersion,
        preferences: schema.userPreferences.preferences,
      })
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, userId));
    return row ?? null;
  }

  async save(userId: string, stored: StoredPreferences, at: Date): Promise<void> {
    await this.db
      .insert(schema.userPreferences)
      .values({ userId, ...stored, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: schema.userPreferences.userId,
        set: { ...stored, updatedAt: at },
      });
  }
}
