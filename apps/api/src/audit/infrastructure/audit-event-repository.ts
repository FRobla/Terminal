import { and, desc, eq, gte, lt, lte, or, schema, type Database } from "@sct/database";
import type { AuditEvent } from "@sct/validation";
import { DrizzleAuditEventWriter } from "@sct/audit";
import type { AuditEventQuery, AuditEventReader } from "../application/ports";

/** Writes through the shared writer and reads for the audit viewer (SPEC-008 AUD-AC-05). */
export class AuditEventRepository extends DrizzleAuditEventWriter implements AuditEventReader {
  constructor(db: Database) {
    super(db);
  }

  async list(query: AuditEventQuery): Promise<AuditEvent[]> {
    const table = schema.auditEvents;
    const conditions = [eq(table.organizationId, query.organizationId)];
    if (query.action) conditions.push(eq(table.action, query.action));
    if (query.actorId) conditions.push(eq(table.actorId, query.actorId));
    if (query.resourceType) conditions.push(eq(table.resourceType, query.resourceType));
    if (query.from) conditions.push(gte(table.occurredAt, query.from));
    if (query.to) conditions.push(lte(table.occurredAt, query.to));
    if (query.cursor) {
      const cursorCondition = or(
        lt(table.occurredAt, query.cursor.occurredAt),
        and(eq(table.occurredAt, query.cursor.occurredAt), lt(table.id, query.cursor.id)),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }

    const rows = await this.db
      .select()
      .from(table)
      .where(and(...conditions))
      .orderBy(desc(table.occurredAt), desc(table.id))
      .limit(query.limit);

    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      organizationId: row.organizationId,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      result: row.result,
      requestId: row.requestId,
      cluster: row.cluster,
      metadata: row.metadata,
    }));
  }
}
