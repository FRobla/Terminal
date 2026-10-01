"use client";

import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { isAddress } from "@solana/kit";
import { AddressText, Button, ErrorState, Panel } from "@sct/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "../auth/use-session";
import { useExplorerLinks } from "../network/use-explorer-links";
import { useNetworkIdentity } from "../network/use-network-identity";
import { ApiRequestError } from "../platform/api-client";
import { usePreferences } from "../preferences/preferences-provider";
import { RecentTransactionsPanel, SolBalancePanel, TokenAccountsPanel } from "./overview-panels";
import { useWalletOverview } from "./use-wallet-overview";
import { TERMINAL_WALLET_CHAIN, useIsHydrated, useWalletClient } from "./wallet-client";
import { WalletConnectionPanel } from "./wallet-connection-panel";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/** SPEC-002 — Wallet Overview: connected wallet by default, any valid address as a watch view. */
export function WalletOverviewView() {
  const client = useWalletClient();
  const hydrated = useIsHydrated();
  const connectedWallet = useConnectedWallet(client);
  // Server HTML never has a connected wallet; keep hydration consistent with it.
  const connected = hydrated ? connectedWallet : null;
  const { session, can, isLoading: sessionLoading } = useSession();
  const { verified } = useNetworkIdentity();
  const [watchAddress, setWatchAddress] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { keyboardShortcuts } = usePreferences();
  const explorer = useExplorerLinks();

  const connectedAddress =
    connected && connected.account.chains.includes(TERMINAL_WALLET_CHAIN) ? connected.account.address : null;
  const target = watchAddress ?? connectedAddress;
  const allowed = session !== null && can("wallet.read");
  const overview = useWalletOverview(target, allowed && verified);

  // WO-AC-14: when the wallet disconnects or switches accounts, the previous account's data is dropped.
  const previousAddress = useRef<string | null>(null);
  useEffect(() => {
    const current = connected?.account.address ?? null;
    if (previousAddress.current && previousAddress.current !== current) {
      queryClient.removeQueries({ queryKey: ["wallets", "overview", previousAddress.current] });
    }
    previousAddress.current = current;
  }, [connected, queryClient]);

  // Keyboard: "/" focuses the address search, "r" refreshes — unless the user turned shortcuts off (SET-AC-06).
  useEffect(() => {
    if (!keyboardShortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "r" && target) {
        void overview.refetch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overview, target, keyboardShortcuts]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (!isAddress(value)) {
      setInputError("Enter a valid base58 Solana address.");
      return;
    }
    setInputError(null);
    setWatchAddress(value);
  };

  const retry = () => void overview.refetch();
  const refreshing = overview.isFetching;
  const queryError = overview.error instanceof ApiRequestError ? overview.error : null;

  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <WalletConnectionPanel session={session} />
        <Panel title="Watch address">
          <form onSubmit={onSubmit} className="space-y-2" noValidate>
            <label htmlFor="watch-address" className="block text-[12px] text-text-secondary">
              View the overview of any Devnet address (read-only).
              {keyboardShortcuts ? (
                <>
                  {" "}
                  Press <kbd className="font-mono">/</kbd> to focus.
                </>
              ) : null}
            </label>
            <input
              id="watch-address"
              ref={searchRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={inputError !== null}
              aria-describedby={inputError ? "watch-address-error" : undefined}
              className="h-7 w-full rounded-[var(--radius-panel)] border border-border-strong bg-bg px-2 font-mono text-[12px]"
              placeholder="Base58 address"
            />
            {inputError ? (
              <p id="watch-address-error" className="text-[11px] text-negative">
                {inputError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit">View</Button>
              {watchAddress ? (
                <Button variant="ghost" onClick={() => setWatchAddress(null)}>
                  Back to connected wallet
                </Button>
              ) : null}
            </div>
          </form>
        </Panel>
      </div>

      <div className="min-w-0 space-y-3">
        {!sessionLoading && !session ? (
          <Panel title="Wallet overview">
            <p className="text-[12px] text-text-secondary">
              Sign in with a Devnet wallet to view wallet data.
            </p>
          </Panel>
        ) : session && !can("wallet.read") ? (
          <ErrorState title="You do not have permission to view wallet data.">
            {session.organization
              ? "Your role does not include wallet.read. Ask an administrator for access."
              : "Your account is not a member of any organization. Ask an administrator for access."}
          </ErrorState>
        ) : !target ? (
          <Panel title="Wallet overview">
            <p className="text-[12px] text-text-secondary">
              {connected
                ? "Wallet disconnected."
                : "Connect a wallet or enter an address to view its overview."}
            </p>
          </Panel>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-text-secondary">{watchAddress ? "Watching" : "Connected wallet"}</span>
                <AddressText
                  value={target}
                  href={overview.data ? explorer.address(target) : undefined}
                  label={watchAddress ? "Watched address" : "Connected wallet"}
                />
              </div>
              <Button
                onClick={retry}
                disabled={refreshing}
                aria-keyshortcuts={keyboardShortcuts ? "r" : undefined}
              >
                {refreshing ? "Refreshing…" : keyboardShortcuts ? "Refresh (R)" : "Refresh"}
              </Button>
            </div>
            {queryError ? (
              <ErrorState title={queryError.message} requestId={queryError.requestId}>
                {overview.data
                  ? "Showing the last successful data; freshness labels indicate its age."
                  : null}
              </ErrorState>
            ) : null}
            {!verified || (queryError && !overview.data) ? null : (
              <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
                <SolBalancePanel overview={overview.data} onRetry={retry} retrying={refreshing} />
                <TokenAccountsPanel overview={overview.data} onRetry={retry} retrying={refreshing} />
                <div className="xl:col-span-2">
                  <RecentTransactionsPanel overview={overview.data} onRetry={retry} retrying={refreshing} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
