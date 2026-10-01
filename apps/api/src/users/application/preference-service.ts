import { PREFERENCES_SCHEMA_VERSION, readStoredPreferences, type UserPreferences } from "@sct/validation";
import type { PreferenceStore } from "./ports";

/**
 * SPEC-025 — per-user terminal preferences. Presentation-only and not sensitive,
 * so changes are not audited (SPEC-025 §4).
 */
export class PreferenceService {
  constructor(private readonly deps: { preferences: PreferenceStore; now?: () => Date }) {}

  /** SET-AC-04/05: stored values merged over defaults, tolerant of older or invalid data. */
  async get(userId: string): Promise<UserPreferences> {
    const stored = await this.deps.preferences.load(userId);
    return readStoredPreferences(stored?.preferences);
  }

  async replace(userId: string, preferences: UserPreferences): Promise<UserPreferences> {
    await this.deps.preferences.save(
      userId,
      { schemaVersion: PREFERENCES_SCHEMA_VERSION, preferences },
      this.deps.now?.() ?? new Date(),
    );
    return preferences;
  }
}
