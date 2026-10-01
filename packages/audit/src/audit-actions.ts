import {
  CUSTODY_TYPES,
  TRANSACTION_PURPOSES,
  TRANSACTION_STATES,
  WALLET_CATEGORIES,
  WALLET_ROLES,
  WALLET_STATUSES,
} from "@sct/validation";
import { z } from "zod";

/**
 * Audit action catalog with a metadata schema per action (SPEC-008 §3–4).
 * Unknown metadata keys are stripped by the schemas.
 */
const address = z.string().max(64);

/** SPEC-004 rule 9 — every transaction transition; signatures use `txSignature` (`signature` is denylisted). */
const transactionTransition = z.object({
  from: z.enum(TRANSACTION_STATES).nullable(),
  to: z.enum(TRANSACTION_STATES),
  purpose: z.enum(TRANSACTION_PURPOSES),
  walletId: z.uuid(),
  txSignature: z.string().max(100).optional(),
  reason: z.string().max(200).optional(),
});

export const AUDIT_ACTION_METADATA = {
  "user.login": z.object({ walletAddress: address, method: z.enum(["signIn", "signMessage"]) }),
  "user.login_failed": z.object({ walletAddress: address.nullable(), reason: z.string().max(200) }),
  "user.logout": z.object({}),
  "wallet.connected": z.object({
    address,
    walletName: z.string().max(128),
    walletChains: z.array(z.string().max(64)).max(32),
  }),
  "wallet.connection_rejected": z.object({
    address,
    walletName: z.string().max(128),
    walletChains: z.array(z.string().max(64)).max(32),
    reason: z.enum(["CLUSTER_MISMATCH"]),
  }),
  "role.assigned": z.object({
    roleKey: z.string().max(64),
    targetUserId: z.uuid(),
    reason: z.string().max(200),
  }),
  "authorization.denied": z.object({ requiredPermission: z.string().max(64), route: z.string().max(200) }),
  // SPEC-025 — user settings
  "user.profile_updated": z.object({ fields: z.array(z.enum(["displayName"])).max(8) }),
  "session.revoked": z.object({
    targetUserId: z.uuid(),
    scope: z.enum(["single", "others", "all"]),
    reason: z.enum(["self service", "owner console", "account disabled"]),
    count: z.number().int().nonnegative(),
  }),
  // SPEC-026 — owner console
  "role.revoked": z.object({
    roleKey: z.string().max(64),
    targetUserId: z.uuid(),
    reason: z.string().max(200),
  }),
  "member.suspended": z.object({ targetUserId: z.uuid() }),
  "member.reactivated": z.object({ targetUserId: z.uuid() }),
  "user.disabled": z.object({ targetUserId: z.uuid(), sessionsRevoked: z.number().int().nonnegative() }),
  "user.enabled": z.object({ targetUserId: z.uuid() }),
  "organization.updated": z.object({
    fields: z.array(z.enum(["name"])).max(8),
    previousName: z.string().max(100),
    name: z.string().max(100),
  }),
  "announcement.updated": z.object({
    enabled: z.boolean(),
    severity: z.enum(["info", "warning", "critical"]),
    messageLength: z.number().int().nonnegative(),
  }),
  "system.cluster_verification_requested": z.object({ verified: z.boolean() }),
  "system.job_enqueued": z.object({ queue: z.string().max(128), jobName: z.string().max(128) }),
  "system.cache_purged": z.object({
    target: z.enum(["wallet-overview", "permissions"]),
    keysDeleted: z.number().int().nonnegative(),
  }),
  // SPEC-009 — wallet registry; SPEC-010 — local wallets
  "wallet.created": z.object({
    address,
    custodyType: z.enum(CUSTODY_TYPES),
    category: z.enum(WALLET_CATEGORIES),
  }),
  "wallet.registration_rejected": z.object({
    address,
    custodyType: z.enum(CUSTODY_TYPES),
    reason: z.enum([
      "CHALLENGE_NOT_FOUND",
      "CHALLENGE_CONSUMED",
      "CHALLENGE_EXPIRED",
      "CHALLENGE_BINDING_MISMATCH",
      "SIGNATURE_INVALID",
    ]),
  }),
  "wallet.updated": z.object({
    address,
    fields: z.array(z.enum(["label", "purpose", "category", "tags", "notes", "status"])).max(8),
    status: z.enum(WALLET_STATUSES).optional(),
  }),
  "wallet.assigned": z.object({ targetUserId: z.uuid(), role: z.enum(WALLET_ROLES) }),
  "wallet.unassigned": z.object({ targetUserId: z.uuid(), role: z.enum(WALLET_ROLES) }),
  "wallet.sync_requested": z.object({ address }),
  "wallet.exported": z.object({ address, format: z.literal("solana-cli-keypair") }),
  // SPEC-004 — transaction lifecycle (one action per target state; failures share transaction.failed)
  "transaction.prepared": transactionTransition,
  "transaction.simulation_requested": transactionTransition,
  "transaction.simulated": transactionTransition,
  "transaction.review_ready": transactionTransition,
  "transaction.cancelled": transactionTransition,
  "transaction.signing_requested": transactionTransition,
  "transaction.submitted": transactionTransition,
  "transaction.confirming": transactionTransition,
  "transaction.confirmed": transactionTransition,
  "transaction.reconciled": transactionTransition,
  "transaction.reconciliation_required": transactionTransition,
  "transaction.failed": transactionTransition,
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_METADATA;
export type AuditMetadata<A extends AuditAction> = z.input<(typeof AUDIT_ACTION_METADATA)[A]>;

/** Keys that must never be persisted in audit metadata, at any depth (AUD-AC-03). */
export const AUDIT_METADATA_DENYLIST = [
  "privatekey",
  "secretkey",
  "seed",
  "mnemonic",
  "passphrase",
  "password",
  "signature",
  "signedmessage",
  "token",
  "sessiontoken",
  "csrftoken",
  "apikey",
  "cookie",
  "authorization",
  "secret",
] as const;

function isDenied(key: string): boolean {
  return (AUDIT_METADATA_DENYLIST as readonly string[]).includes(key.toLowerCase());
}

export function removeDeniedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeDeniedKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isDenied(key))
        .map(([key, nested]) => [key, removeDeniedKeys(nested)]),
    );
  }
  return value;
}

export function sanitizeAuditMetadata<A extends AuditAction>(
  action: A,
  metadata: AuditMetadata<A>,
): Record<string, unknown> {
  const parsed = AUDIT_ACTION_METADATA[action].parse(metadata) as Record<string, unknown>;
  return removeDeniedKeys(parsed) as Record<string, unknown>;
}
