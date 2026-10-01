/** The authenticated caller of an application operation, with client metadata for audit records. */
export interface Actor {
  userId: string;
  sessionId: string;
  organizationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Audit fields shared by every event an actor causes. */
export function actorAuditFields(actor: Actor) {
  return {
    actorType: "user" as const,
    actorId: actor.userId,
    organizationId: actor.organizationId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  };
}
