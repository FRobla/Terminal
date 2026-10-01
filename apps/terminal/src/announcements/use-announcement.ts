"use client";

import { announcementInputSchema, currentAnnouncementSchema, type AnnouncementInput } from "@sct/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../auth/use-session";
import { apiRequest } from "../platform/api-client";

/** SPEC-026 OWN-AC-11 — the platform-wide announcement. */

export const ANNOUNCEMENT_QUERY_KEY = ["announcements", "current"] as const;

export function useCurrentAnnouncement() {
  const { session } = useSession();
  return useQuery({
    queryKey: ANNOUNCEMENT_QUERY_KEY,
    queryFn: ({ signal }) => apiRequest("/announcements/current", currentAnnouncementSchema, { signal }),
    enabled: session !== null,
    refetchInterval: 5 * 60_000,
  });
}

export function useSaveAnnouncement() {
  const queryClient = useQueryClient();
  const csrfToken = useSession().session?.csrfToken;
  return useMutation({
    mutationFn: (input: AnnouncementInput) =>
      apiRequest("/admin/announcement", currentAnnouncementSchema, {
        method: "PUT",
        body: announcementInputSchema.parse(input),
        csrfToken,
      }),
    onSuccess: (announcement) => queryClient.setQueryData(ANNOUNCEMENT_QUERY_KEY, announcement),
  });
}
