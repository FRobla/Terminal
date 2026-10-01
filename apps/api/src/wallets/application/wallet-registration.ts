import type { PermittedCluster } from "@sct/network";
import type { Logger } from "@sct/observability";
import type { ManagedWallet, RegisterWalletRequest } from "@sct/validation";
import type { AuditLog } from "@sct/audit";
import { actorAuditFields, type Actor } from "../../auth/application/actor";
import type { SignatureVerifier, UnitOfWork } from "../../auth/application/ports";
import { generateNonce } from "../../auth/domain/session-token";
import { isCategoryAllowed, MAX_ACTIVE_WALLETS_PER_ORGANIZATION } from "../domain/managed-wallet";
import {
  buildOwnershipMessage,
  checkOwnershipChallenge,
  OWNERSHIP_CHALLENGE_TTL_MS,
  type OwnershipRejectionReason,
} from "../domain/ownership-challenge";
import { toManagedWallet } from "./managed-wallet-view";
import type {
  OrganizationMemberDirectory,
  OwnershipChallengeStore,
  WalletStore,
  WalletSyncScheduler,
} from "./registry-ports";

export type OrganizationActor = Actor & { organizationId: string };

export type RegistrationFailure =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "WALLET_ALREADY_REGISTERED" }
  | { code: "OPERATION_NOT_ALLOWED"; message: string }
  | { code: "WALLET_OWNERSHIP_UNVERIFIED"; reason: OwnershipRejectionReason };

export type RegistrationResult =
  { ok: true; wallet: ManagedWallet } | { ok: false; failure: RegistrationFailure };

/** SPEC-009 §4.1–4.2 — ownership challenges and wallet registration. */
export class WalletRegistration {
  constructor(
    private readonly config: { cluster: PermittedCluster; publicAppOrigin: string },
    private readonly deps: {
      unitOfWork: UnitOfWork;
      wallets: WalletStore;
      challenges: OwnershipChallengeStore;
      members: OrganizationMemberDirectory;
      verifier: SignatureVerifier;
      syncScheduler: WalletSyncScheduler;
      audit: AuditLog;
      logger: Pick<Logger, "warn">;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  async issueChallenge(actor: OrganizationActor, address: string) {
    const slug = await this.deps.members.slugOf(actor.organizationId);
    if (!slug) throw new Error("The active organization no longer exists");
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + OWNERSHIP_CHALLENGE_TTL_MS);
    const nonce = generateNonce();
    const message = buildOwnershipMessage({
      domain: new URL(this.config.publicAppOrigin).host,
      address,
      cluster: this.config.cluster,
      organizationSlug: slug,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
    });
    const challengeId = await this.deps.challenges.create({
      organizationId: actor.organizationId,
      userId: actor.userId,
      address,
      cluster: this.config.cluster,
      nonce,
      message,
      issuedAt,
      expiresAt,
    });
    return { challengeId, message, expiresAt: expiresAt.toISOString() };
  }

  /** WRG-AC-01..04 */
  async register(actor: OrganizationActor, request: RegisterWalletRequest): Promise<RegistrationResult> {
    if (!isCategoryAllowed(request.category, request.custodyType)) {
      return {
        ok: false,
        failure: {
          code: "VALIDATION_FAILED",
          message: "The WATCH_ONLY category requires watch-only custody.",
        },
      };
    }
    const now = this.now();
    const cluster = this.config.cluster;

    const outcome = await this.deps.unitOfWork.run(
      async (transaction): Promise<RegistrationResult | string> => {
        if (
          await this.deps.wallets.existsByAddress(actor.organizationId, request.address, cluster, transaction)
        ) {
          return { ok: false, failure: { code: "WALLET_ALREADY_REGISTERED" } };
        }
        if (
          (await this.deps.wallets.countActive(actor.organizationId, cluster, transaction)) >=
          MAX_ACTIVE_WALLETS_PER_ORGANIZATION
        ) {
          return {
            ok: false,
            failure: {
              code: "OPERATION_NOT_ALLOWED",
              message: `An organization can hold at most ${MAX_ACTIVE_WALLETS_PER_ORGANIZATION} active wallets.`,
            },
          };
        }

        if (request.custodyType !== "WATCH_ONLY") {
          const challenge = await this.deps.challenges.lock(request.ownership.challengeId, transaction);
          const expected = {
            organizationId: actor.organizationId,
            userId: actor.userId,
            address: request.address,
            cluster,
          };
          let reason: OwnershipRejectionReason | null = checkOwnershipChallenge(challenge, expected, now);
          if (!reason && challenge) {
            const verified = await this.deps.verifier.verify(
              request.address,
              new TextEncoder().encode(challenge.message),
              Buffer.from(request.ownership.signature, "base64"),
            );
            if (!verified) reason = "SIGNATURE_INVALID";
          }
          if (reason) return { ok: false, failure: { code: "WALLET_OWNERSHIP_UNVERIFIED", reason } };
          await this.deps.challenges.markConsumed(request.ownership.challengeId, now, transaction);
        }

        const walletId = await this.deps.wallets.insert(
          {
            organizationId: actor.organizationId,
            address: request.address,
            cluster,
            label: request.label,
            purpose: request.purpose ?? null,
            category: request.category,
            custodyType: request.custodyType,
            notes: request.notes ?? null,
            tags: request.tags ?? [],
            createdByUserId: actor.userId,
            createdAt: now,
          },
          transaction,
        );
        // A concurrent registration of the same address won the unique constraint.
        if (!walletId) return { ok: false, failure: { code: "WALLET_ALREADY_REGISTERED" } };
        await this.deps.audit.record(
          {
            action: "wallet.created",
            resourceType: "wallet",
            resourceId: walletId,
            result: "success",
            cluster,
            ...actorAuditFields(actor),
            metadata: {
              address: request.address,
              custodyType: request.custodyType,
              category: request.category,
            },
          },
          transaction,
        );
        return walletId;
      },
    );

    if (typeof outcome !== "string") {
      if (outcome.ok === false && outcome.failure.code === "WALLET_OWNERSHIP_UNVERIFIED") {
        await this.deps.audit.record({
          action: "wallet.registration_rejected",
          resourceType: "wallet",
          resourceId: request.address,
          result: "failure",
          cluster,
          ...actorAuditFields(actor),
          metadata: {
            address: request.address,
            custodyType: request.custodyType,
            reason: outcome.failure.reason,
          },
        });
      }
      return outcome;
    }

    try {
      await this.deps.syncScheduler.enqueue(outcome, `sync-${outcome}-registered`);
    } catch (error) {
      // Registration is committed; the next sweep (≤ 60 s) synchronizes the wallet instead.
      this.deps.logger.warn({ err: error, walletId: outcome }, "Initial wallet sync could not be enqueued");
    }
    const wallet = await this.deps.wallets.find(actor.organizationId, cluster, outcome);
    if (!wallet) throw new Error("The registered wallet could not be read back");
    return { ok: true, wallet: toManagedWallet(wallet, actor.userId) };
  }
}
