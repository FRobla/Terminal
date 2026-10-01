import type { PermittedCluster } from "@sct/network";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields } from "../../auth/application/actor";
import type { WalletStore } from "./registry-ports";
import type { OrganizationActor } from "./wallet-registration";

export type ExportFailure = { code: "WALLET_NOT_FOUND" } | { code: "OPERATION_NOT_ALLOWED"; message: string };

/**
 * SPEC-010 §4.4 (LWG-AC-07) — records an export of local recovery material before the
 * browser decrypts it. The key is on the user's device, so this is a policy and audit
 * gate, not a cryptographic one. No key material reaches the API.
 */
export class WalletExports {
  constructor(
    private readonly config: { cluster: PermittedCluster },
    private readonly deps: { wallets: WalletStore; audit: AuditLog; now?: () => Date },
  ) {}

  async record(
    actor: OrganizationActor,
    walletId: string,
  ): Promise<{ ok: true; recordedAt: string } | { ok: false; failure: ExportFailure }> {
    const wallet = await this.deps.wallets.find(actor.organizationId, this.config.cluster, walletId);
    if (!wallet) return { ok: false, failure: { code: "WALLET_NOT_FOUND" } };
    if (wallet.custodyType !== "LOCAL_ENCRYPTED") {
      return {
        ok: false,
        failure: {
          code: "OPERATION_NOT_ALLOWED",
          message: "Only locally generated wallets have recovery material.",
        },
      };
    }
    await this.deps.audit.record({
      action: "wallet.exported",
      resourceType: "wallet",
      resourceId: walletId,
      result: "success",
      cluster: this.config.cluster,
      ...actorAuditFields(actor),
      metadata: { address: wallet.address, format: "solana-cli-keypair" },
    });
    return { ok: true, recordedAt: (this.deps.now?.() ?? new Date()).toISOString() };
  }
}
