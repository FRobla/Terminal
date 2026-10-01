import { WALLET_STANDARD_CHAINS, type PermittedCluster } from "@sct/network";
import type { SiwsInput } from "@sct/validation";
import type { AuditLog } from "../../audit/application/audit-log";
import { buildSiwsMessage, diffSiwsFields, parseSiwsMessage, type SiwsFields } from "../domain/siws-message";
import { generateNonce, generateSessionToken, hashSessionToken } from "../domain/session-token";
import type {
  ChallengeStore,
  IdentityStore,
  MembershipStore,
  SessionStore,
  SignatureVerifier,
  UnitOfWork,
} from "./ports";

export const SIWS_STATEMENT =
  "Sign in to Solana Corporate Terminal. This request does not trigger a blockchain transaction or cost any fees.";
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const DEFAULT_ORGANIZATION_SLUG = "default";

export interface SignInConfig {
  cluster: PermittedCluster;
  publicAppOrigin: string;
  sessionTtlSeconds: number;
  bootstrapOwnerWalletAddress: string | undefined;
  /** Temporary policy until membership management exists: role granted to users without any membership (RBAC-AC-05). */
  defaultMemberRole: string | undefined;
}

export interface ClientMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export type SignInFailureCode = "SIWS_CHALLENGE_INVALID" | "SIWS_SIGNATURE_INVALID" | "ACCOUNT_DISABLED";

export type VerifySignInResult =
  | { ok: true; sessionToken: string; sessionId: string; expiresAt: Date; userId: string }
  | { ok: false; code: SignInFailureCode; reason: string };

/** Sign-In With Solana (SPEC-007 §3). */
export class SignInService {
  constructor(
    private readonly config: SignInConfig,
    private readonly deps: {
      unitOfWork: UnitOfWork;
      challenges: ChallengeStore;
      identities: IdentityStore;
      memberships: MembershipStore;
      sessions: SessionStore;
      verifier: SignatureVerifier;
      audit: AuditLog;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** AUTH-AC-01 */
  async issueChallenge(address: string, client: ClientMetadata) {
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
    const origin = new URL(this.config.publicAppOrigin);
    const input: SiwsInput = {
      domain: origin.host,
      address,
      statement: SIWS_STATEMENT,
      uri: origin.origin,
      version: "1",
      chainId: WALLET_STANDARD_CHAINS[this.config.cluster].slice("solana:".length),
      nonce: generateNonce(),
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
    };
    const message = buildSiwsMessage(input);
    const challengeId = await this.deps.challenges.create({
      address,
      cluster: this.config.cluster,
      nonce: input.nonce,
      message,
      issuedAt,
      expiresAt,
      requesterIp: client.ipAddress,
    });
    return { challengeId, input, message };
  }

  /** AUTH-AC-02, AUTH-AC-03, RBAC-AC-04 */
  async verify(
    request: {
      challengeId: string;
      address: string;
      signedMessage: Uint8Array;
      signature: Uint8Array;
      method: "signIn" | "signMessage";
    },
    client: ClientMetadata,
  ): Promise<VerifySignInResult> {
    const now = this.now();
    return this.deps.unitOfWork.run(async (transaction) => {
      const fail = async (code: SignInFailureCode, reason: string) => {
        await this.deps.audit.record(
          {
            action: "user.login_failed",
            resourceType: "session",
            result: "failure",
            actorType: "anonymous",
            cluster: this.config.cluster,
            ipAddress: client.ipAddress,
            userAgent: client.userAgent,
            metadata: { walletAddress: request.address, reason },
          },
          transaction,
        );
        return { ok: false as const, code, reason };
      };

      const challenge = await this.deps.challenges.lockById(request.challengeId, transaction);
      if (!challenge) return fail("SIWS_CHALLENGE_INVALID", "unknown challenge");
      if (challenge.consumedAt) return fail("SIWS_CHALLENGE_INVALID", "challenge already used");
      // The challenge is single-use from here on, whatever the outcome.
      await this.deps.challenges.markConsumed(challenge.id, now, transaction);
      if (challenge.expiresAt.getTime() <= now.getTime())
        return fail("SIWS_CHALLENGE_INVALID", "challenge expired");
      if (challenge.cluster !== this.config.cluster)
        return fail("SIWS_CHALLENGE_INVALID", "cluster mismatch");
      if (challenge.address !== request.address) return fail("SIWS_CHALLENGE_INVALID", "address mismatch");

      const expected = parseSiwsMessage(challenge.message) as SiwsFields | null;
      const signed = parseSiwsMessage(
        new TextDecoder("utf-8", { fatal: false }).decode(request.signedMessage),
      );
      if (!expected || !signed) return fail("SIWS_SIGNATURE_INVALID", "signed message is not a SIWS message");
      const differences = diffSiwsFields(signed, expected);
      if (differences.length > 0) {
        return fail("SIWS_SIGNATURE_INVALID", `signed message differs in: ${differences.join(", ")}`);
      }
      const valid = await this.deps.verifier.verify(
        request.address,
        request.signedMessage,
        request.signature,
      );
      if (!valid) return fail("SIWS_SIGNATURE_INVALID", "signature verification failed");

      const identity = await this.deps.identities.findOrCreateUserByWallet(
        request.address,
        this.config.cluster,
        now,
        transaction,
      );
      // OWN-AC-07: a disabled account cannot start new sessions.
      if (identity.status === "disabled") return fail("ACCOUNT_DISABLED", "account disabled");

      if (this.config.bootstrapOwnerWalletAddress === request.address) {
        const bootstrap = await this.deps.memberships.grantBootstrapOwnerIfUnowned(
          identity.userId,
          DEFAULT_ORGANIZATION_SLUG,
          transaction,
        );
        if (bootstrap.granted) {
          await this.deps.audit.record(
            {
              action: "role.assigned",
              resourceType: "membership",
              resourceId: identity.userId,
              result: "success",
              actorType: "system",
              organizationId: bootstrap.organizationId,
              metadata: { roleKey: "owner", targetUserId: identity.userId, reason: "bootstrap owner" },
            },
            transaction,
          );
        }
      }

      if (this.config.defaultMemberRole) {
        const grant = await this.deps.memberships.grantDefaultRoleIfUnaffiliated(
          identity.userId,
          DEFAULT_ORGANIZATION_SLUG,
          this.config.defaultMemberRole,
          transaction,
        );
        if (grant.granted) {
          await this.deps.audit.record(
            {
              action: "role.assigned",
              resourceType: "membership",
              resourceId: identity.userId,
              result: "success",
              actorType: "system",
              organizationId: grant.organizationId,
              metadata: {
                roleKey: this.config.defaultMemberRole,
                targetUserId: identity.userId,
                reason: "default member role",
              },
            },
            transaction,
          );
        }
      }

      const organization = await this.deps.memberships.findFirstActiveOrganization(
        identity.userId,
        transaction,
      );
      const sessionToken = generateSessionToken();
      const expiresAt = new Date(now.getTime() + this.config.sessionTtlSeconds * 1000);
      const sessionId = await this.deps.sessions.create(
        {
          tokenHash: hashSessionToken(sessionToken),
          userId: identity.userId,
          walletAddress: request.address,
          activeOrganizationId: organization?.id ?? null,
          createdAt: now,
          expiresAt,
          ipAddress: client.ipAddress,
          userAgent: client.userAgent?.slice(0, 512) ?? null,
        },
        transaction,
      );

      await this.deps.audit.record(
        {
          action: "user.login",
          resourceType: "session",
          resourceId: sessionId,
          result: "success",
          actorType: "user",
          actorId: identity.userId,
          organizationId: organization?.id ?? null,
          cluster: this.config.cluster,
          ipAddress: client.ipAddress,
          userAgent: client.userAgent,
          metadata: { walletAddress: request.address, method: request.method },
        },
        transaction,
      );

      return { ok: true as const, sessionToken, sessionId, expiresAt, userId: identity.userId };
    });
  }
}
