import type { PermittedCluster } from "@sct/network";
import type { ManagedWallet, WalletRole } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields } from "../../auth/application/actor";
import type { UnitOfWork } from "../../auth/application/ports";
import { toManagedWallet } from "./managed-wallet-view";
import type { OrganizationMember, OrganizationMemberDirectory, WalletStore } from "./registry-ports";
import type { OrganizationActor } from "./wallet-registration";

export type AssignmentFailure = { code: "WALLET_NOT_FOUND" } | { code: "VALIDATION_FAILED"; message: string };

/** SPEC-009 §4.6 — application wallet roles for organization members (WRG-AC-09). */
export class WalletAssignments {
  constructor(
    private readonly config: { cluster: PermittedCluster },
    private readonly deps: {
      unitOfWork: UnitOfWork;
      wallets: WalletStore;
      members: OrganizationMemberDirectory;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  members(actor: OrganizationActor): Promise<OrganizationMember[]> {
    return this.deps.members.listActive(actor.organizationId);
  }

  assign(actor: OrganizationActor, walletId: string, userId: string, role: WalletRole) {
    return this.change(actor, walletId, userId, role, "assign");
  }

  unassign(actor: OrganizationActor, walletId: string, userId: string, role: WalletRole) {
    return this.change(actor, walletId, userId, role, "unassign");
  }

  private async change(
    actor: OrganizationActor,
    walletId: string,
    userId: string,
    role: WalletRole,
    operation: "assign" | "unassign",
  ): Promise<{ ok: true; wallet: ManagedWallet } | { ok: false; failure: AssignmentFailure }> {
    const cluster = this.config.cluster;
    const now = this.deps.now?.() ?? new Date();
    const failure = await this.deps.unitOfWork.run(async (transaction): Promise<AssignmentFailure | null> => {
      if (!(await this.deps.wallets.lock(actor.organizationId, cluster, walletId, transaction))) {
        return { code: "WALLET_NOT_FOUND" };
      }
      if (operation === "assign") {
        if (!(await this.deps.members.isActiveMember(actor.organizationId, userId, transaction))) {
          return {
            code: "VALIDATION_FAILED",
            message: "The user is not an active member of this organization.",
          };
        }
        const added = await this.deps.wallets.addAssignment(
          { walletId, userId, role, assignedByUserId: actor.userId, at: now },
          transaction,
        );
        if (!added) return null;
      } else {
        const removed = await this.deps.wallets.removeAssignment({ walletId, userId, role }, transaction);
        if (!removed) return null;
      }
      await this.deps.audit.record(
        {
          action: operation === "assign" ? "wallet.assigned" : "wallet.unassigned",
          resourceType: "wallet",
          resourceId: walletId,
          result: "success",
          cluster,
          ...actorAuditFields(actor),
          metadata: { targetUserId: userId, role },
        },
        transaction,
      );
      return null;
    });
    if (failure) return { ok: false, failure };
    const record = await this.deps.wallets.find(actor.organizationId, cluster, walletId);
    if (!record) return { ok: false, failure: { code: "WALLET_NOT_FOUND" } };
    return { ok: true, wallet: toManagedWallet(record, actor.userId) };
  }
}
