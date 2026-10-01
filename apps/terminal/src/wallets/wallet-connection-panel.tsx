"use client";

import {
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import type { SessionResponse } from "@sct/validation";
import { walletConnectionResponseSchema } from "@sct/validation";
import { AddressText, Button, EmptyState, ErrorState, LoadingState, Panel } from "@sct/ui";
import { useEffect, useRef } from "react";
import { useWalletSignIn } from "../auth/use-wallet-sign-in";
import { ApiRequestError, apiRequest } from "../platform/api-client";
import { TERMINAL_WALLET_CHAIN, useIsHydrated, useWalletClient } from "./wallet-client";

function describeError(error: unknown): { title: string; requestId?: string | undefined } {
  if (error instanceof ApiRequestError) return { title: error.message, requestId: error.requestId };
  if (error instanceof Error && error.name !== "AbortError") return { title: error.message };
  return { title: "The wallet request failed." };
}

/**
 * WO-AC-01, WO-AC-02, WO-AC-14, WO-AC-15 — connected wallet, the cluster check, sign-in,
 * and connection auditing. Connecting happens from the status bar (WalletConnectControl).
 */
export function WalletConnectionPanel(props: { session: SessionResponse | null }) {
  const client = useWalletClient();
  // Until hydration completes, render what the server rendered: the plugin is still 'pending' there.
  const hydrated = useIsHydrated();
  const walletReady = useIsWalletReady(client);
  const ready = hydrated && walletReady;
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const disconnect = useDisconnect(client);
  const { signIn, pending: signingIn, error: signInError } = useWalletSignIn();

  const supportsCluster = connected ? connected.account.chains.includes(TERMINAL_WALLET_CHAIN) : false;

  // Record each (session, account) connection once; the API audits it (WO-AC-02 / WO-AC-15).
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!props.session || !connected) return;
    const key = `${props.session.user.id}:${connected.account.address}`;
    if (recorded.current === key) return;
    recorded.current = key;
    void apiRequest("/wallets/connections", walletConnectionResponseSchema, {
      method: "POST",
      csrfToken: props.session.csrfToken,
      body: {
        address: connected.account.address,
        walletName: connected.wallet.name.slice(0, 128),
        walletChains: [...connected.account.chains].slice(0, 32),
      },
    }).catch(() => {
      recorded.current = null;
    });
  }, [props.session, connected]);

  return (
    <Panel title="Wallet">
      {!ready ? (
        <LoadingState operation="Checking for a previously connected wallet…" rows={1} />
      ) : connected ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <img src={connected.wallet.icon} alt="" width={16} height={16} />
            <span className="text-text-secondary">{connected.wallet.name}</span>
            <AddressText value={connected.account.address} label="Connected wallet" />
          </div>
          {!supportsCluster ? (
            <ErrorState title="This wallet account is not configured for Solana Devnet.">
              Switch the wallet network to Devnet. No data is requested and no signature can be made with this
              account.
            </ErrorState>
          ) : !props.session ? (
            <div className="space-y-2">
              <p className="text-[12px] text-text-secondary">
                Sign in by signing a text message with this wallet. It does not create a transaction or cost
                any fees.
              </p>
              <Button variant="primary" onClick={() => void signIn()} disabled={signingIn}>
                {signingIn ? "Waiting for wallet signature…" : "Sign in with this wallet"}
              </Button>
              {signInError ? <ErrorState {...describeError(signInError)} /> : null}
            </div>
          ) : props.session.walletAddress !== connected.account.address ? (
            <p className="text-[12px] text-text-secondary">
              Signed in as <AddressText value={props.session.walletAddress} label="Signed-in wallet" />. The
              connected account differs; its overview is shown read-only.
            </p>
          ) : null}
          <Button variant="ghost" onClick={() => disconnect.dispatch()}>
            Disconnect wallet
          </Button>
        </div>
      ) : wallets.length === 0 ? (
        <EmptyState>
          No Solana wallet supporting Devnet was detected. Install a Wallet Standard compatible wallet and
          enable Devnet.
        </EmptyState>
      ) : (
        <p className="text-[12px] text-text-secondary">
          Use the Connect button in the top bar to connect a wallet, sign in, and view its overview.
        </p>
      )}
    </Panel>
  );
}
