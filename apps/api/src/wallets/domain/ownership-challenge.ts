import type { Cluster } from "@sct/network";

/** SPEC-009 §3 — proof of control for wallet registration. */

export const OWNERSHIP_CHALLENGE_TTL_MS = 5 * 60_000;

export interface OwnershipMessageFields {
  domain: string;
  address: string;
  cluster: Cluster;
  organizationSlug: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

/**
 * Server-built text signed with `signMessage`. It names the account, network,
 * and organization and states that no transaction is authorized; it can never
 * be parsed as a transaction message.
 */
export function buildOwnershipMessage(fields: OwnershipMessageFields): string {
  return [
    `${fields.domain} asks you to prove control of this Solana account for the wallet registry.`,
    "",
    `Account: ${fields.address}`,
    `Network: ${fields.cluster}`,
    `Organization: ${fields.organizationSlug}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
    "",
    "Signing this message does not authorize any transaction.",
  ].join("\n");
}

export interface OwnershipChallenge {
  id: string;
  organizationId: string;
  userId: string;
  address: string;
  cluster: Cluster;
  message: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export type OwnershipRejectionReason =
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_CONSUMED"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_BINDING_MISMATCH"
  | "SIGNATURE_INVALID";

/** WRG-AC-03 — the challenge must be unused, unexpired, and bound to the same organization, user, address, and cluster. */
export function checkOwnershipChallenge(
  challenge: OwnershipChallenge | null,
  expected: { organizationId: string; userId: string; address: string; cluster: Cluster },
  now: Date,
): Exclude<OwnershipRejectionReason, "SIGNATURE_INVALID"> | null {
  if (!challenge) return "CHALLENGE_NOT_FOUND";
  if (challenge.consumedAt) return "CHALLENGE_CONSUMED";
  if (challenge.expiresAt.getTime() <= now.getTime()) return "CHALLENGE_EXPIRED";
  if (
    challenge.organizationId !== expected.organizationId ||
    challenge.userId !== expected.userId ||
    challenge.address !== expected.address ||
    challenge.cluster !== expected.cluster
  ) {
    return "CHALLENGE_BINDING_MISMATCH";
  }
  return null;
}
