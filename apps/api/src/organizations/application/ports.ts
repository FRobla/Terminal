import type { Cluster } from "@sct/network";
import type { Transaction } from "../../auth/application/ports";

export interface MemberRecord {
  id: string;
  displayName: string | null;
  status: "active" | "disabled";
  createdAt: Date;
  walletIdentities: Array<{ address: string; cluster: Cluster; lastSeenAt: Date }>;
  membership: {
    status: "active" | "suspended";
    roles: Array<{ key: string; name: string }>;
    createdAt: Date;
  } | null;
  activeSessionCount: number;
  lastActivityAt: Date | null;
}

export interface MemberDirectory {
  /** Users ordered by id (time-ordered UUID v7), after `cursor`; membership data for `organizationId`. */
  list(query: {
    organizationId: string;
    limit: number;
    cursor?: string | undefined;
    idleSince: Date;
    now: Date;
  }): Promise<MemberRecord[]>;
  find(query: {
    organizationId: string;
    userId: string;
    idleSince: Date;
    now: Date;
  }): Promise<MemberRecord | null>;
  /** Replaces the member's roles with one system role, creating or reactivating the membership. */
  setSingleRole(
    command: { organizationId: string; userId: string; roleKey: string; grantedByUserId: string; at: Date },
    transaction: Transaction,
  ): Promise<{ removedRoleKeys: string[]; alreadyHeld: boolean; reactivated: boolean }>;
  setMembershipStatus(
    command: { organizationId: string; userId: string; status: "active" | "suspended"; at: Date },
    transaction: Transaction,
  ): Promise<void>;
  setUserStatus(
    command: { userId: string; status: "active" | "disabled"; at: Date },
    transaction: Transaction,
  ): Promise<void>;
}

export interface OrganizationRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  members: { active: number; suspended: number };
}

export interface RoleRecord {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
  activeMembers: number;
}

export interface OrganizationDirectory {
  find(organizationId: string): Promise<OrganizationRecord | null>;
  rename(organizationId: string, name: string, at: Date, transaction: Transaction): Promise<void>;
  /** System roles plus the organization's custom roles, with active member counts in the organization. */
  roles(organizationId: string): Promise<RoleRecord[]>;
}

/** Drops cached permissions so administrative changes apply on the next request. */
export interface PermissionCache {
  invalidatePermissions(): number;
}
