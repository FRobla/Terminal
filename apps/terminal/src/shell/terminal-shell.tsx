"use client";

import { Button, truncateMiddle } from "@sct/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AnnouncementBanner } from "../announcements/announcement-banner";
import { useSession, useSignOut } from "../auth/use-session";
import { ClusterGuard } from "../network/cluster-guard";
import { NetworkIndicator } from "../network/network-indicator";
import { useNetworkIdentity } from "../network/use-network-identity";
import { ProviderStatusText } from "../system/provider-status";
import { useProviderHealth } from "../system/use-provider-health";
import { WalletConnectControl } from "../wallets/wallet-connect-control";

/** Only capabilities that exist are listed (prompt §106). Settings needs a session (SET-AC-01). */
const NAVIGATION = [
  { href: "/", label: "Wallet overview", requiresSession: false },
  { href: "/wallets", label: "Wallets", requiresSession: true },
  { href: "/transactions", label: "Transactions", requiresSession: true },
  { href: "/system", label: "System", requiresSession: false },
  { href: "/settings", label: "Settings", requiresSession: true },
] as const;

function StatusBar() {
  const { identity } = useNetworkIdentity();
  const { session, can } = useSession();
  const providers = useProviderHealth(session !== null && can("system.read"));
  const unhealthy = providers.data?.filter((provider) => provider.status !== "HEALTHY") ?? [];
  const signOut = useSignOut();

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-1 px-3 py-1.5 text-[11px]">
      <NetworkIndicator />
      <span className="text-text-secondary">
        Cluster{" "}
        {identity === undefined ? (
          <span className="text-text-muted">checking…</span>
        ) : identity.verified ? (
          <span className="text-positive">verified</span>
        ) : (
          <span className="text-negative">unverified</span>
        )}
      </span>
      {providers.data ? (
        <Link href="/system" className="text-text-secondary hover:text-text-primary">
          Providers{" "}
          {unhealthy.length === 0 ? (
            <ProviderStatusText status="HEALTHY" />
          ) : (
            unhealthy.map((provider) => (
              <span key={provider.providerId}>
                {provider.displayName}: <ProviderStatusText status={provider.status} />
              </span>
            ))
          )}
        </Link>
      ) : null}
      <span className="ml-auto flex flex-wrap items-center gap-2 text-text-secondary">
        {session ? (
          <>
            <Link
              href="/settings/profile"
              className="text-text-primary hover:underline"
              title="Your profile and settings"
            >
              {session.user.displayName ?? truncateMiddle(session.walletAddress)}
            </Link>
            <span>{session.organization?.name ?? "No organization"}</span>
            <Button
              variant="ghost"
              className="h-6"
              onClick={() => signOut.mutate(session.csrfToken)}
              disabled={signOut.isPending}
            >
              Sign out
            </Button>
          </>
        ) : (
          <span>Signed out</span>
        )}
        <WalletConnectControl signedIn={session !== null} />
      </span>
    </div>
  );
}

export function TerminalShell(props: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useSession();
  const navigation = NAVIGATION.filter((item) => !item.requiresSession || session !== null);
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:bg-surface-2 focus:p-2"
      >
        Skip to content
      </a>
      <header>
        <StatusBar />
        <AnnouncementBanner />
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="Primary" className="border-b border-border md:w-48 md:border-r md:border-b-0">
          <p className="hidden px-3 pt-3 pb-2 text-[11px] font-semibold tracking-wider text-text-muted uppercase md:block">
            Solana Corporate Terminal
          </p>
          <ul className="flex md:flex-col">
            {navigation.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block px-3 py-1.5 text-[12px] ${active ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <main id="main" className="min-w-0 flex-1">
          <ClusterGuard>
            <div className="p-3">{props.children}</div>
          </ClusterGuard>
        </main>
      </div>
    </div>
  );
}
