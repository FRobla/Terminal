import { schema, type Database } from "@sct/database";
import type { AuditEventRecord, AuditEventWriter } from "./audit-event-record";

/** Inserts audit rows; the application role may only insert and select (SPEC-008 AUD-AC-02). */
export class DrizzleAuditEventWriter implements AuditEventWriter {
  constructor(protected readonly db: Database) {}

  async insert(record: AuditEventRecord, transaction?: unknown): Promise<void> {
    const executor = (transaction as Database | undefined) ?? this.db;
    await executor.insert(schema.auditEvents).values(record);
  }
}
