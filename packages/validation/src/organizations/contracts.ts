import { CLUSTERS } from "@sct/network";
import { z } from "zod";
import { ASSIGNABLE_ROLE_KEYS, PERMISSIONS } from "../auth/permissions";
import { isoTimestampSchema } from "../contract-primitives";
import { plainTextSchema } from "../plain-text";
import { MEMBERSHIP_STATUSES, roleSummarySchema, USER_STATUSES } from "../users/contracts";
import { walletAddressSchema } from "../wallets/contracts";

/** SPEC-026 — owner console: members, organization, roles. */

export const PROTECTION_REASONS = ["SELF", "OWNER_PROTECTED"] as const;
export type ProtectionReason = (typeof PROTECTION_REASONS)[number];

export const adminUserSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  status: z.enum(USER_STATUSES),
  createdAt: isoTimestampSchema,
  walletIdentities: z.array(
    z.object({ address: walletAddressSchema, cluster: z.enum(CLUSTERS), lastSeenAt: isoTimestampSchema }),
  ),
  membership: z
    .object({
      status: z.enum(MEMBERSHIP_STATUSES),
      roles: z.array(roleSummarySchema),
      createdAt: isoTimestampSchema,
    })
    .nullable(),
  activeSessionCount: z.number().int().nonnegative(),
  lastActivityAt: isoTimestampSchema.nullable(),
  /** Why console actions on this account are refused, or null when it can be managed. */
  protectedReason: z.enum(PROTECTION_REASONS).nullable(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.uuid().optional(),
  })
  .strict();

export const userIdParamsSchema = z.object({ userId: z.uuid() }).strict();

export const setRoleRequestSchema = z.object({ roleKey: z.enum(ASSIGNABLE_ROLE_KEYS) }).strict();

export const setMembershipStatusRequestSchema = z.object({ status: z.enum(MEMBERSHIP_STATUSES) }).strict();

export const setUserStatusRequestSchema = z.object({ status: z.enum(USER_STATUSES) }).strict();

export const organizationNameSchema = plainTextSchema({ max: 100 });

export const adminOrganizationSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  members: z.object({ active: z.number().int(), suspended: z.number().int() }),
});

export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

export const updateOrganizationRequestSchema = z.object({ name: organizationNameSchema }).strict();

export const roleMatrixSchema = z.object({
  permissions: z.array(z.object({ key: z.enum(PERMISSIONS), description: z.string() })),
  roles: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      isSystem: z.boolean(),
      permissions: z.array(z.string()),
      activeMembers: z.number().int().nonnegative(),
    }),
  ),
});

export type RoleMatrix = z.infer<typeof roleMatrixSchema>;
