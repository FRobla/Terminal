"use client";

import { walletOverviewSchema } from "@sct/validation";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../platform/api-client";

export const OVERVIEW_REFRESH_INTERVAL_MS = 30_000;

/**
 * WO-AC-16: refreshes every 30 s only while the tab is visible; manual refresh
 * is always available. The query key includes the address, so data for one
 * address is never shown for another (WO-AC-14).
 */
export function useWalletOverview(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["wallets", "overview", address],
    queryFn: ({ signal }) =>
      apiRequest(
        `/wallets/${encodeURIComponent(address ?? "")}/overview?signaturesLimit=20`,
        walletOverviewSchema,
        {
          signal,
        },
      ),
    enabled: enabled && address !== null,
    refetchInterval: OVERVIEW_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
