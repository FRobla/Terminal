"use client";

import { providerHealthListSchema } from "@sct/validation";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../platform/api-client";

export function useProviderHealth(enabled: boolean) {
  return useQuery({
    queryKey: ["system", "providers"],
    queryFn: ({ signal }) => apiRequest("/system/providers", providerHealthListSchema, { signal }),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
