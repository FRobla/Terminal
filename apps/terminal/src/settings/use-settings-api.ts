"use client";

import { profileSchema, sessionRevocationResponseSchema, sessionSummarySchema } from "@sct/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SESSION_QUERY_KEY, useSession } from "../auth/use-session";
import { apiRequest } from "../platform/api-client";

/** SPEC-025 — the caller's profile and sessions. */

const PROFILE_QUERY_KEY = ["me", "profile"] as const;
const OWN_SESSIONS_QUERY_KEY = ["me", "sessions"] as const;

export function useProfile() {
  const { session } = useSession();
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/me/profile", profileSchema, { signal }),
    enabled: session !== null,
  });
}

export function useUpdateDisplayName() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  return useMutation({
    mutationFn: (displayName: string | null) =>
      apiRequest("/me/profile", profileSchema, {
        method: "PATCH",
        body: { displayName },
        csrfToken: session?.csrfToken,
      }),
    onSuccess: async (profile) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}

export function useOwnSessions() {
  const { session } = useSession();
  return useQuery({
    queryKey: OWN_SESSIONS_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/me/sessions", z.array(sessionSummarySchema), { signal }),
    enabled: session !== null,
    refetchInterval: 60_000,
  });
}

export function useRevokeOwnSessions() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  return useMutation({
    /** A session id revokes that session; `null` revokes every other session. */
    mutationFn: (sessionId: string | null) =>
      apiRequest(
        sessionId ? `/me/sessions/${encodeURIComponent(sessionId)}/revoke` : "/me/sessions/revoke-others",
        sessionRevocationResponseSchema,
        { method: "POST", csrfToken: session?.csrfToken },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: OWN_SESSIONS_QUERY_KEY }),
  });
}
