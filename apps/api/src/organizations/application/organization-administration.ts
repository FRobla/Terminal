import {
  PERMISSION_DESCRIPTIONS,
  PERMISSIONS,
  type AdminOrganization,
  type RoleMatrix,
} from "@sct/validation";
import type { AuditLog } from "../../audit/application/audit-log";
import { actorAuditFields } from "../../auth/application/actor";
import type { UnitOfWork } from "../../auth/application/ports";
import { ApiError } from "../../platform/api-error";
import type { OrganizationActor } from "./member-administration";
import type { OrganizationDirectory, OrganizationRecord } from "./ports";

/** SPEC-026 OWN-AC-10 — the active organization and its role matrix. */
export class OrganizationAdministration {
  constructor(
    private readonly deps: {
      unitOfWork: UnitOfWork;
      organizations: OrganizationDirectory;
      audit: AuditLog;
      /** Called after a rename so cached session organizations refresh. */
      onOrganizationChanged: () => void;
      now?: () => Date;
    },
  ) {}

  private static toContract(record: OrganizationRecord): AdminOrganization {
    return {
      id: record.id,
      slug: record.slug,
      name: record.name,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      members: record.members,
    };
  }

  private async load(organizationId: string): Promise<OrganizationRecord> {
    const record = await this.deps.organizations.find(organizationId);
    if (!record) throw new ApiError("NOT_FOUND");
    return record;
  }

  async get(actor: OrganizationActor): Promise<AdminOrganization> {
    return OrganizationAdministration.toContract(await this.load(actor.organizationId));
  }

  async rename(actor: OrganizationActor, name: string): Promise<AdminOrganization> {
    const current = await this.load(actor.organizationId);
    if (current.name !== name) {
      await this.deps.unitOfWork.run(async (transaction) => {
        await this.deps.organizations.rename(
          actor.organizationId,
          name,
          this.deps.now?.() ?? new Date(),
          transaction,
        );
        await this.deps.audit.record(
          {
            action: "organization.updated",
            resourceType: "organization",
            resourceId: actor.organizationId,
            result: "success",
            ...actorAuditFields(actor),
            metadata: { fields: ["name"], previousName: current.name, name },
          },
          transaction,
        );
      });
      this.deps.onOrganizationChanged();
    }
    return this.get(actor);
  }

  async roleMatrix(actor: OrganizationActor): Promise<RoleMatrix> {
    return {
      permissions: PERMISSIONS.map((key) => ({ key, description: PERMISSION_DESCRIPTIONS[key] })),
      roles: await this.deps.organizations.roles(actor.organizationId),
    };
  }
}
