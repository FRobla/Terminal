"use client";

import { EXPLORER_NAMES } from "@sct/network";
import { DisplaySettingsProvider } from "@sct/ui";
import { DEFAULT_USER_PREFERENCES, userPreferencesSchema, type UserPreferences } from "@sct/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useSession } from "../auth/use-session";
import { apiRequest } from "../platform/api-client";

export const PREFERENCES_QUERY_KEY = ["me", "preferences"] as const;

interface PreferencesState {
  preferences: UserPreferences;
  /** True once the signed-in user's stored preferences are known. */
  loaded: boolean;
  error: unknown;
}

const PreferencesContext = createContext<PreferencesState>({
  preferences: DEFAULT_USER_PREFERENCES,
  loaded: false,
  error: null,
});

/**
 * SET-AC-06: loads the signed-in user's preferences and applies them to the whole
 * terminal. Signed out, or while loading, the defaults apply.
 */
export function PreferencesProvider(props: { children: ReactNode }) {
  const { session } = useSession();
  const query = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/me/preferences", userPreferencesSchema, { signal }),
    enabled: session !== null,
    staleTime: 5 * 60_000,
  });
  const preferences = session && query.data ? query.data : DEFAULT_USER_PREFERENCES;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.density = preferences.density;
    root.dataset.reduceMotion = String(preferences.reduceMotion);
  }, [preferences.density, preferences.reduceMotion]);

  const display = useMemo(
    () => ({
      timeZone: preferences.timeZone,
      addressDisplay: preferences.addressDisplay,
      explorerName: EXPLORER_NAMES[preferences.explorer],
    }),
    [preferences.timeZone, preferences.addressDisplay, preferences.explorer],
  );

  const state = useMemo(
    () => ({ preferences, loaded: session !== null && query.isSuccess, error: query.error }),
    [preferences, session, query.isSuccess, query.error],
  );

  return (
    <PreferencesContext.Provider value={state}>
      <DisplaySettingsProvider value={display}>{props.children}</DisplaySettingsProvider>
    </PreferencesContext.Provider>
  );
}

/** The effective preferences of the current user (defaults when signed out). */
export function usePreferences(): UserPreferences {
  return useContext(PreferencesContext).preferences;
}

/** Preferences with their load state, for the preferences editor. */
export function usePreferencesState(): PreferencesState {
  return useContext(PreferencesContext);
}

export function useSavePreferences() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  return useMutation({
    mutationFn: (preferences: UserPreferences) =>
      apiRequest("/me/preferences", userPreferencesSchema, {
        method: "PUT",
        body: preferences,
        csrfToken: session?.csrfToken,
      }),
    onSuccess: (saved) => queryClient.setQueryData(PREFERENCES_QUERY_KEY, saved),
  });
}
