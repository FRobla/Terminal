import type { Cluster } from "@sct/network";

export interface ProfileRecord {
  user: { id: string; displayName: string | null; status: "active" | "disabled"; createdAt: Date };
  walletIdentities: Array<{ address: string; cluster: Cluster; firstSeenAt: Date; lastSeenAt: Date }>;
  roles: Array<{ key: string; name: string }>;
}

export interface ProfileStore {
  /** Roles are those of the user's active membership in `organizationId`, if any. */
  load(userId: string, organizationId: string | null): Promise<ProfileRecord | null>;
  updateDisplayName(userId: string, displayName: string | null, at: Date): Promise<void>;
}

export interface StoredPreferences {
  schemaVersion: number;
  preferences: Record<string, unknown>;
}

export interface PreferenceStore {
  load(userId: string): Promise<StoredPreferences | null>;
  save(userId: string, stored: StoredPreferences, at: Date): Promise<void>;
}
