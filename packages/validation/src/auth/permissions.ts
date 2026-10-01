/** Permission catalog (SPEC-007 §5). Authorization is enforced by the API; the terminal uses it for UX only. */
export const PERMISSIONS = [
  "organization.read",
  "organization.manage",
  "wallet.read",
  "wallet.create",
  "wallet.export",
  "wallet.fund",
  "wallet.control",
  "trading.read",
  "trading.quote",
  "trading.execute",
  "token.read",
  "token.create",
  "token.manage",
  "intelligence.read",
  "alerts.read",
  "alerts.manage",
  "audit.read",
  "system.read",
  "system.manage",
  "platform.administer",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  "organization.read": "View organization details and members",
  "organization.manage": "Manage organization settings, members, and roles",
  "wallet.read": "View wallet overviews, balances, and history",
  "wallet.create": "Create or register wallets",
  "wallet.export": "Export public keys or recovery material through an explicit flow",
  "wallet.fund": "Initiate funding transfers",
  "wallet.control": "Initiate transactions from managed wallets",
  "trading.read": "View trading data",
  "trading.quote": "Request swap quotes",
  "trading.execute": "Execute swaps",
  "token.read": "View token data",
  "token.create": "Create tokens",
  "token.manage": "Change token authorities and metadata",
  "intelligence.read": "View intelligence",
  "alerts.read": "View alerts",
  "alerts.manage": "Create and modify alerts",
  "audit.read": "View the audit log",
  "system.read": "View system and provider health",
  "system.manage": "Manage providers and system settings",
  "platform.administer": "Operate the owner console: platform administration and developer tooling",
};

const ALL: readonly Permission[] = PERMISSIONS;

/** Permissions reserved for the owner role (SPEC-026 §3). */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ["platform.administer"];

/** Seeded system roles (SPEC-007 §6). */
export const SYSTEM_ROLES = {
  owner: { name: "Owner", permissions: ALL },
  admin: {
    name: "Administrator",
    permissions: ALL.filter((permission) => !OWNER_ONLY_PERMISSIONS.includes(permission)),
  },
  operator: {
    name: "Operator",
    permissions: [
      "organization.read",
      "wallet.read",
      "wallet.create",
      "wallet.export",
      "wallet.fund",
      "wallet.control",
      "token.read",
      "trading.read",
      "trading.quote",
      "intelligence.read",
      "alerts.read",
      "alerts.manage",
      "system.read",
    ],
  },
  trader: {
    name: "Trader",
    permissions: [
      "organization.read",
      "wallet.read",
      "trading.read",
      "trading.quote",
      "trading.execute",
      "token.read",
      "intelligence.read",
      "alerts.read",
    ],
  },
  analyst: {
    name: "Analyst",
    permissions: [
      "organization.read",
      "wallet.read",
      "trading.read",
      "trading.quote",
      "token.read",
      "intelligence.read",
      "alerts.read",
    ],
  },
  auditor: {
    name: "Auditor",
    permissions: ["organization.read", "wallet.read", "audit.read", "system.read"],
  },
  viewer: {
    name: "Viewer",
    permissions: [
      "organization.read",
      "wallet.read",
      "token.read",
      "trading.read",
      "intelligence.read",
      "alerts.read",
    ],
  },
} as const satisfies Record<string, { name: string; permissions: readonly Permission[] }>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

/** Roles the owner console can grant; ownership is never granted there (SPEC-026 §3). */
export const ASSIGNABLE_ROLE_KEYS = ["admin", "operator", "trader", "analyst", "auditor", "viewer"] as const;
export type AssignableRoleKey = (typeof ASSIGNABLE_ROLE_KEYS)[number];
