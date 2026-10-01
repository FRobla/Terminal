"use client";

import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import type { SessionResponse } from "@sct/validation";
import { walletConnectionResponseSchema } from "@sct/validation";
import { AddressText, Button, EmptyState, ErrorState, LoadingState, Panel } from "@sct/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { signInWithWallet } from "../auth/sign-in";
import { SESSION_QUERY_KEY } from "../auth/use-session";
import { ApiRequestError, apiRequest } from "../platform/api-client";
import { TERMINAL_WALLET_CHAIN, useIsHydrated, useWalletClient } from "./wallet-client";

function describeError(error: unknown): { title: string; requestId?: string | undefined } {
  if (error instanceof ApiRequestError) return { title: error.message, requestId: error.requestId };
  if (error instanceof Error && error.name !== "AbortError") return { title: error.message };
  return { title: "The wallet request failed." };
}

/**
 * WO-AC-01, WO-AC-02, WO-AC-14, WO-AC-15 — wallet discovery, connection, the cluster
 * check, sign-in, and connection auditing.
 */
export function WalletConnectionPanel(props: { session: SessionResponse | null }) {
  const client = useWalletClient();
  // Until hydration completes, render what the server rendered: the plugin is still 'pending' there.
  const hydrated = useIsHydrated();
  const walletReady = useIsWalletReady(client);
  const ready = hydrated && walletReady;
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const connect = useConnect(client);
  const disconnect = useDisconnect(client);
  const queryClient = useQueryClient();
  const [signInError, setSignInError] = useState<unknown>(null);
  const [signingIn, setSigningIn] = useState(false);

  const address = connected?.account.address ?? null;
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

  const onSignIn = async () => {
    if (!connected || !address) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      await signInWithWallet(client, connected.wallet, address);
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    } catch (error) {
      setSignInError(error);
    } finally {
      setSigningIn(false);
    }
  };

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
              <Button variant="primary" onClick={onSignIn} disabled={signingIn}>
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
        <div className="space-y-2">
          <p className="text-[12px] text-text-secondary">Connect a wallet to view its overview.</p>
          <ul className="flex flex-wrap gap-2" aria-label="Detected wallets">
            {wallets.map((wallet) => (
              <li key={wallet.name}>
                <Button onClick={() => connect.dispatch(wallet)} disabled={connect.isRunning}>
                  <img src={wallet.icon} alt="" width={14} height={14} />
                  Connect {wallet.name}
                </Button>
              </li>
            ))}
          </ul>
          {connect.error && (connect.error as Error).name !== "AbortError" ? (
            <ErrorState title="The wallet connection was not completed." />
          ) : null}
        </div>
      )}
    </Panel>
  );
}
