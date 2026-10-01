"use client";

import { walletOverviewSchema } from "@sct/validation";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../platform/api-client";
import { usePreferences } from "../preferences/preferences-provider";
import { overviewRefreshInterval } from "./overview-refresh";

/**
 * WO-AC-16: refreshes at the user's interval (default 30 s, never faster) only while the
 * tab is visible; manual refresh is always available. The query key includes the address,
 * so data for one address is never shown for another (WO-AC-14).
 */
export function useWalletOverview(address: string | null, enabled: boolean) {
  const { overviewRefreshSeconds } = usePreferences();
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
    refetchInterval: overviewRefreshInterval(overviewRefreshSeconds),
    refetchIntervalInBackground: false,
  });
}
