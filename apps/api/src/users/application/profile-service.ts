import type { Permission, Profile } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields, type Actor } from "../../auth/application/actor";
import { ApiError } from "../../platform/api-error";
import type { ProfileStore } from "./ports";

/** SPEC-025 — the caller's profile (SET-AC-02, SET-AC-03). */
export class ProfileService {
  constructor(private readonly deps: { profiles: ProfileStore; audit: AuditLog; now?: () => Date }) {}

  async get(
    actor: Actor,
    organization: Profile["organization"],
    permissions: ReadonlySet<Permission>,
  ): Promise<Profile> {
    const record = await this.deps.profiles.load(actor.userId, organization?.id ?? null);
    if (!record) throw new ApiError("NOT_FOUND");
    return {
      user: {
        id: record.user.id,
        displayName: record.user.displayName,
        status: record.user.status,
        createdAt: record.user.createdAt.toISOString(),
      },
      walletIdentities: record.walletIdentities.map((identity) => ({
        address: identity.address,
        cluster: identity.cluster,
        firstSeenAt: identity.firstSeenAt.toISOString(),
        lastSeenAt: identity.lastSeenAt.toISOString(),
      })),
      organization,
      roles: record.roles,
      permissions: [...permissions].sort(),
    };
  }

  async updateDisplayName(actor: Actor, displayName: string | null): Promise<void> {
    await this.deps.profiles.updateDisplayName(actor.userId, displayName, this.deps.now?.() ?? new Date());
    await this.deps.audit.record({
      action: "user.profile_updated",
      resourceType: "user",
      resourceId: actor.userId,
      result: "success",
      ...actorAuditFields(actor),
      metadata: { fields: ["displayName"] },
    });
  }
}
