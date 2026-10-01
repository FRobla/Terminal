"use client";

import { WALLET_STANDARD_CHAINS } from "@sct/network";
import { createClient } from "@solana/kit";
import { walletWithoutSigner, type ClientWithWallet } from "@solana/kit-plugin-wallet";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { publicConfig } from "../platform/public-config";

/**
 * Wallet Standard client bound to the configured cluster's chain. Discovery only
 * lists wallets that support that chain. No signer is attached: Iteration 01 only
 * connects and signs the sign-in message; transactions arrive in Iteration 02.
 */
const WalletClientContext = createContext<ClientWithWallet | null>(null);

export const TERMINAL_WALLET_CHAIN = WALLET_STANDARD_CHAINS[publicConfig.NEXT_PUBLIC_SOLANA_CLUSTER];

export function WalletClientProvider(props: { children: ReactNode }) {
  const [client] = useState(() =>
    createClient().use(walletWithoutSigner({ chain: TERMINAL_WALLET_CHAIN, storageKey: "sct:wallet" })),
  );
  useEffect(() => () => client[Symbol.dispose]?.(), [client]);
  return <WalletClientContext.Provider value={client}>{props.children}</WalletClientContext.Provider>;
}

export function useWalletClient(): ClientWithWallet {
  const client = useContext(WalletClientContext);
  if (!client) throw new Error("useWalletClient must be used inside WalletClientProvider");
  return client;
}
