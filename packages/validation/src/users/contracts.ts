import { CLUSTERS, EXPLORERS } from "@sct/network";
import { z } from "zod";
import { PERMISSIONS } from "../auth/permissions";
import { isoTimestampSchema } from "../contract-primitives";
import { plainTextSchema } from "../plain-text";
import { walletAddressSchema } from "../wallets/contracts";

/** SPEC-025 — profile and preferences contracts. */

export const USER_STATUSES = ["active", "disabled"] as const;
export const MEMBERSHIP_STATUSES = ["active", "suspended"] as const;

export const displayNameSchema = plainTextSchema({ max: 64 });

export const roleSummarySchema = z.object({ key: z.string(), name: z.string() });

export const walletIdentitySchema = z.object({
  address: walletAddressSchema,
  cluster: z.enum(CLUSTERS),
  firstSeenAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema,
});

export const profileSchema = z.object({
  user: z.object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    status: z.enum(USER_STATUSES),
    createdAt: isoTimestampSchema,
  }),
  walletIdentities: z.array(walletIdentitySchema),
  organization: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
  roles: z.array(roleSummarySchema),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export type Profile = z.infer<typeof profileSchema>;

export const updateProfileRequestSchema = z.object({ displayName: displayNameSchema.nullable() }).strict();

export const PREFERENCES_SCHEMA_VERSION = 1;

export const OVERVIEW_REFRESH_OPTIONS = [0, 30, 60, 120] as const;

const preferenceFields = {
  timeZone: z.enum(["local", "utc"]),
  density: z.enum(["compact", "comfortable"]),
  reduceMotion: z.boolean(),
  explorer: z.enum(EXPLORERS),
  /** Seconds between automatic Wallet Overview refreshes; 0 disables it. Never below 30 (WO-AC-16). */
  overviewRefreshSeconds: z.literal(OVERVIEW_REFRESH_OPTIONS),
  keyboardShortcuts: z.boolean(),
  addressDisplay: z.enum(["short", "full"]),
};

export const userPreferencesSchema = z.object(preferenceFields).strict();

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  timeZone: "local",
  density: "compact",
  reduceMotion: false,
  explorer: "solana-explorer",
  overviewRefreshSeconds: 30,
  keyboardShortcuts: true,
  addressDisplay: "short",
};

/**
 * SET-AC-05: reads stored preferences tolerantly. Unknown keys are dropped and each
 * missing or invalid value falls back to its default, so schema changes never break a user.
 */
export function readStoredPreferences(stored: unknown): UserPreferences {
  const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(preferenceFields)) {
    const parsed = schema.safeParse(source[key]);
    result[key] = parsed.success ? parsed.data : DEFAULT_USER_PREFERENCES[key as keyof UserPreferences];
  }
  return result as UserPreferences;
}
