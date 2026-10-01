"use client";

import {
  useConnect,
  useConnectedWallet,
  useIsWalletReady,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { Button } from "@sct/ui";
import { useWalletSignIn } from "../auth/use-wallet-sign-in";
import { TERMINAL_WALLET_CHAIN, useIsHydrated, useWalletClient } from "./wallet-client";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.name !== "AbortError") return error.message;
  return "The wallet request was not completed.";
}

/**
 * Status-bar wallet connection (WO-AC-01, AUTH-AC-07): one `Connect <wallet>` button per detected
 * Devnet wallet. Signed out, connecting also signs in with that wallet in the same action.
 */
export function WalletConnectControl(props: { signedIn: boolean }) {
  const client = useWalletClient();
  const hydrated = useIsHydrated();
  const walletReady = useIsWalletReady(client);
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const connect = useConnect(client);
  const { signIn, pending, error } = useWalletSignIn();

  // Signed out with a connected account, the buttons stay: they re-authorize and sign in.
  if (!hydrated || !walletReady || (props.signedIn && connected)) return null;

  const unavailableReason =
    connected && !connected.account.chains.includes(TERMINAL_WALLET_CHAIN)
      ? "Switch the connected wallet to Devnet to sign in."
      : wallets.length === 0
        ? "No Devnet wallet detected."
        : null;
  const failure =
    error ?? (connect.error && (connect.error as Error).name !== "AbortError" ? connect.error : null);

  return (
    <>
      {unavailableReason ? (
        <span className="text-text-muted">{unavailableReason}</span>
      ) : pending || connect.isRunning ? (
        <span>Waiting for wallet…</span>
      ) : (
        wallets.map((wallet) => (
          <Button
            key={wallet.name}
            onClick={() => (props.signedIn ? connect.dispatch(wallet) : void signIn(wallet))}
          >
            <img src={wallet.icon} alt="" width={14} height={14} />
            Connect {wallet.name}
          </Button>
        ))
      )}
      {failure ? (
        <span role="alert" className="text-negative">
          {errorMessage(failure)}
        </span>
      ) : null}
    </>
  );
}
