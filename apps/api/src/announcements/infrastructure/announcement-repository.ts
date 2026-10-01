import { eq, schema, type Database } from "@sct/database";
import type { AnnouncementInput } from "@sct/validation";
import type { Transaction } from "../../auth/application/ports";
import type { AnnouncementStore, StoredAnnouncement } from "../application/announcement-service";

const SETTING_KEY = "announcement";

/** The announcement is one row of `platform_settings`. */
export class AnnouncementRepository implements AnnouncementStore {
  constructor(private readonly db: Database) {}

  async load(): Promise<StoredAnnouncement | null> {
    const [row] = await this.db
      .select({
        value: schema.platformSettings.value,
        updatedAt: schema.platformSettings.updatedAt,
        updatedById: schema.users.id,
        updatedByName: schema.users.displayName,
      })
      .from(schema.platformSettings)
      .leftJoin(schema.users, eq(schema.users.id, schema.platformSettings.updatedByUserId))
      .where(eq(schema.platformSettings.key, SETTING_KEY));
    if (!row) return null;
    return {
      value: row.value,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedById ? { id: row.updatedById, displayName: row.updatedByName } : null,
    };
  }

  async save(
    value: AnnouncementInput,
    schemaVersion: number,
    updatedByUserId: string,
    at: Date,
    transaction: Transaction,
  ): Promise<void> {
    await (transaction as Database)
      .insert(schema.platformSettings)
      .values({ key: SETTING_KEY, schemaVersion, value, updatedByUserId, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: schema.platformSettings.key,
        set: { schemaVersion, value, updatedByUserId, updatedAt: at },
      });
  }
}
