"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { PreferencesProvider } from "../preferences/preferences-provider";
import { WalletClientProvider } from "../wallets/wallet-client";

export function Providers(props: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retries are handled server-side by the provider pipeline; avoid multiplying load.
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 5_000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <WalletClientProvider>{props.children}</WalletClientProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
