"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { UiWallet } from "@wallet-standard/ui";
import { useState } from "react";
import { TERMINAL_WALLET_CHAIN, useWalletClient } from "../wallets/wallet-client";
import { signInWithWallet } from "./sign-in";
import { SESSION_QUERY_KEY } from "./use-session";

/**
 * SPEC-007 §3 sign-in shared by the status bar and the wallet panel. `signIn()` uses the
 * connected wallet; `signIn(wallet)` connects that wallet first (wallets usually skip the
 * prompt when the site is already authorized), then signs in with it.
 */
export function useWalletSignIn() {
  const client = useWalletClient();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const signIn = async (walletToConnect?: UiWallet) => {
    setPending(true);
    setError(null);
    try {
      if (walletToConnect) await client.wallet.connect(walletToConnect);
      const connected = client.wallet.getState().connected;
      if (!connected) throw new Error("Connect a wallet to sign in.");
      // The status bar and the wallet panel already explain an account without Devnet.
      if (!connected.account.chains.includes(TERMINAL_WALLET_CHAIN)) return;
      await signInWithWallet(client, connected.wallet, connected.account.address);
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    } catch (caught) {
      // A superseded wallet request (e.g. a double click) is not a failure.
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught);
    } finally {
      setPending(false);
    }
  };

  return { signIn, pending, error, clearError: () => setError(null) };
}
