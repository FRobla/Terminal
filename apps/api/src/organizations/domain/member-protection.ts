import type { ProtectionReason } from "@sct/validation";

export const OWNER_ROLE_KEY = "owner";

/**
 * SPEC-026 §3 / OWN-AC-05: console actions never target the caller themself or an owner.
 * Ownership changes require the dedicated transfer flow (Iteration 08).
 */
export function protectionReason(
  actorUserId: string,
  target: { userId: string; roleKeys: readonly string[] },
): ProtectionReason | null {
  if (target.userId === actorUserId) return "SELF";
  if (target.roleKeys.includes(OWNER_ROLE_KEY)) return "OWNER_PROTECTED";
  return null;
}
