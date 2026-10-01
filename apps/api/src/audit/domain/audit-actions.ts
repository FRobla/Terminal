import { z } from "zod";

/**
 * Audit action catalog with a metadata schema per action (SPEC-008 §3–4).
 * Unknown metadata keys are stripped by the schemas.
 */
const address = z.string().max(64);

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
