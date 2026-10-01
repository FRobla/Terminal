import type { AuditEvent } from "@sct/validation";

export interface AuditEventQuery {
  organizationId: string;
  limit: number;
  cursor?: { occurredAt: Date; id: string } | undefined;
  action?: string | undefined;
  actorId?: string | undefined;
  resourceType?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface AuditEventReader {
  list(query: AuditEventQuery): Promise<AuditEvent[]>;
}
