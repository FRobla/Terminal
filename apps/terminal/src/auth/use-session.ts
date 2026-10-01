"use client";

import { sessionResponseSchema, type Permission, type SessionResponse } from "@sct/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiRequestError, apiRequest } from "../platform/api-client";

export const SESSION_QUERY_KEY = ["auth", "session"] as const;

/** Current session, or null when signed out. Permissions here are for UX only. */
export function useSession() {
  const query = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async ({ signal }): Promise<SessionResponse | null> => {
      try {
        return await apiRequest("/auth/session", sessionResponseSchema, { signal });
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          (error.code === "UNAUTHENTICATED" || error.code === "SESSION_EXPIRED")
        ) {
          return null;
        }
        throw error;
      }
    },
    refetchInterval: 5 * 60_000,
  });
  const session = query.data ?? null;
  return {
    ...query,
    session,
    can: (permission: Permission) => session?.permissions.includes(permission) ?? false,
  };
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (csrfToken: string) =>
      apiRequest("/auth/logout", z.object({ loggedOut: z.literal(true) }), { method: "POST", csrfToken }),
    onSettled: async () => {
      // Nothing from the previous session may leak into the next one.
      for (const queryKey of [["wallets"], ["me"], ["admin"], ["announcements"]]) {
        queryClient.removeQueries({ queryKey });
      }
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
  });
}
