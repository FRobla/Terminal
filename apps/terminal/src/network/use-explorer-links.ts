"use client";

import { explorerAddressUrl, explorerTransactionUrl } from "@sct/network";
import { useMemo } from "react";
import { publicConfig } from "../platform/public-config";
import { usePreferences } from "../preferences/preferences-provider";

/** Explorer links for the configured cluster in the user's preferred explorer (NET-AC-07, SET-AC-06). */
export function useExplorerLinks() {
  const { explorer } = usePreferences();
  return useMemo(() => {
    const cluster = publicConfig.NEXT_PUBLIC_SOLANA_CLUSTER;
    return {
      address: (address: string) => explorerAddressUrl(cluster, address, explorer),
      transaction: (signature: string) => explorerTransactionUrl(cluster, signature, explorer),
    };
  }, [explorer]);
}
