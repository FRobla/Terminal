import type { Cluster } from "@sct/network";
import { currentRequestContext } from "@sct/observability";
import { type AuditAction, type AuditMetadata, sanitizeAuditMetadata } from "./audit-actions";
import type { AuditEventRecord, AuditEventWriter } from "./audit-event-record";

export interface AuditEventInput<A extends AuditAction> {
  action: A;
  resourceType: string;
  resourceId?: string | null;
  result: "success" | "failure" | "denied";
  actorType: "user" | "system" | "worker" | "anonymous";
  actorId?: string | null;
  organizationId?: string | null;
  cluster?: Cluster | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata: AuditMetadata<A>;
}

/** Records audit events with request correlation and sanitized metadata (SPEC-008). */
export class AuditLog {
  constructor(
    private readonly writer: AuditEventWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  toRecord<A extends AuditAction>(input: AuditEventInput<A>): AuditEventRecord {
    const context = currentRequestContext();
    return {
      occurredAt: this.now(),
      organizationId: input.organizationId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      result: input.result,
      requestId: context?.requestId ?? "system",
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
      cluster: input.cluster ?? null,
      metadata: sanitizeAuditMetadata(input.action, input.metadata),
    };
  }

  /** Persists the event, optionally inside the caller's database transaction. */
  async record<A extends AuditAction>(input: AuditEventInput<A>, transaction?: unknown): Promise<void> {
    await this.writer.insert(this.toRecord(input), transaction);
  }
}
