import { announcementInputSchema, type Announcement, type AnnouncementInput } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields, type Actor } from "../../auth/application/actor";
import type { Transaction, UnitOfWork } from "../../auth/application/ports";

export const ANNOUNCEMENT_SCHEMA_VERSION = 1;

export interface StoredAnnouncement {
  value: Record<string, unknown>;
  updatedAt: Date;
  updatedBy: { id: string; displayName: string | null } | null;
}

export interface AnnouncementStore {
  load(): Promise<StoredAnnouncement | null>;
  save(
    value: AnnouncementInput,
    schemaVersion: number,
    updatedByUserId: string,
    at: Date,
    transaction: Transaction,
  ): Promise<void>;
}

/** SPEC-026 OWN-AC-11 — the platform-wide announcement banner. */
export class AnnouncementService {
  constructor(
    private readonly deps: {
      unitOfWork: UnitOfWork;
      store: AnnouncementStore;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  /** `null` when nothing was saved, or when the stored value no longer matches the schema. */
  async current(): Promise<Announcement | null> {
    const stored = await this.deps.store.load();
    if (!stored) return null;
    const parsed = announcementInputSchema.safeParse(stored.value);
    if (!parsed.success) return null;
    return { ...parsed.data, updatedAt: stored.updatedAt.toISOString(), updatedBy: stored.updatedBy };
  }

  async update(actor: Actor, input: AnnouncementInput): Promise<Announcement | null> {
    await this.deps.unitOfWork.run(async (transaction) => {
      await this.deps.store.save(
        input,
        ANNOUNCEMENT_SCHEMA_VERSION,
        actor.userId,
        this.deps.now?.() ?? new Date(),
        transaction,
      );
      await this.deps.audit.record(
        {
          action: "announcement.updated",
          resourceType: "platform_setting",
          resourceId: "announcement",
          result: "success",
          ...actorAuditFields(actor),
          metadata: { enabled: input.enabled, severity: input.severity, messageLength: input.message.length },
        },
        transaction,
      );
    });
    return this.current();
  }
}
