"use client";

import {
  AddressText,
  Button,
  DataUnavailable,
  EmptyState,
  ErrorState,
  FreshnessLabel,
  LoadingState,
  Panel,
  ProvenanceDetails,
  ScrollRegion,
  Select,
  TextInput,
  Timestamp,
} from "@sct/ui";
import {
  CUSTODY_TYPES,
  WALLET_CATEGORIES,
  type CustodyType,
  type ManagedWallet,
  type Sourced,
  type WalletCategory,
  type WalletStatus,
} from "@sct/validation";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useSession } from "../auth/use-session";
import { useExplorerLinks } from "../network/use-explorer-links";
import { ApiRequestError } from "../platform/api-client";
import { CreateLocalWalletPanel } from "../local-wallets/create-local-wallet-panel";
import { UnregisteredKeysPanel } from "../local-wallets/unregistered-keys-panel";
import { useLocalKeyAddresses } from "../local-wallets/use-local-keys";
import { RegisterWalletPanel, type RegistrationMode } from "./register-wallet-panel";
import { useWalletList, type WalletFilters } from "./registry-api";
import { CATEGORY_LABELS, CUSTODY_LABELS } from "./registry-labels";
import { formatSol } from "./sol-amount";
import { OVERVIEW_STALE_AFTER_MS } from "./sourced-panel";

type Balances = Sourced<{ walletId: string; lamports: string }[]>;

/** Sync status in words: never synced, failing, or the last success time. */
export function SyncStatus(props: { sync: ManagedWallet["sync"] }) {
  const { sync } = props;
  const failing =
    sync.lastFailureAt !== null && (sync.lastSuccessAt === null || sync.lastFailureAt > sync.lastSuccessAt);
  if (failing) {
    return (
      <span className="text-warning">
        Sync failing ({sync.lastFailureReason ?? "unknown reason"})
        {sync.lastSuccessAt ? (
          <>
            {" "}
            · last success <Timestamp value={sync.lastSuccessAt} />
          </>
        ) : null}
      </span>
    );
  }
  if (!sync.lastSuccessAt) return <span className="text-text-muted">Not indexed yet</span>;
  return (
    <span className="text-text-secondary">
      {sync.indexedCount} indexed · <Timestamp value={sync.lastSuccessAt} />
    </span>
  );
}

function BalanceCell(props: { balances: Balances; walletId: string }) {
  if (props.balances.status === "UNAVAILABLE") {
    return <span className="font-mono text-[11px] text-warning">DATA UNAVAILABLE</span>;
  }
  const row = props.balances.value.find((entry) => entry.walletId === props.walletId);
  if (!row) return <span className="text-text-muted">—</span>;
  return <span className="font-mono tabular">{formatSol(row.lamports)} SOL</span>;
}

/** LWG-AC-06 — custody, plus whether a local key is stored in this browser. */
function CustodyText(props: { wallet: ManagedWallet; localKeys: Set<string> | undefined }) {
  if (props.wallet.custodyType !== "LOCAL_ENCRYPTED") return <>{CUSTODY_LABELS[props.wallet.custodyType]}</>;
  const present = props.localKeys?.has(props.wallet.address);
  return (
    <>
      {CUSTODY_LABELS.LOCAL_ENCRYPTED}
      {present === undefined ? null : (
        <span className={`block text-[10px] ${present ? "text-positive" : "text-text-muted"}`}>
          {present ? "Key on this device" : "Key not on this device"}
        </span>
      )}
    </>
  );
}

function WalletRows(props: { pages: { wallets: ManagedWallet[]; balances: Balances }[] }) {
  const explorer = useExplorerLinks();
  const localKeys = useLocalKeyAddresses();
  const rows = props.pages.flatMap((page) =>
    page.wallets.map((wallet) => ({ wallet, balances: page.balances })),
  );
  return (
    <>
      <ScrollRegion label="Registered wallets" className="hidden overflow-x-auto md:block">
        <table className="w-full text-[12px]">
          <caption className="sr-only">Registered wallets of the organization, newest first</caption>
          <thead className="text-left text-[11px] text-text-muted uppercase">
            <tr className="border-b border-border">
              <th scope="col" className="py-1 pr-3 font-medium">
                Label
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Address
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Category
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Custody
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Tags
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                SOL balance
              </th>
              <th scope="col" className="py-1 font-medium">
                History
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ wallet, balances }) => (
              <tr
                key={wallet.id}
                className={`border-b border-border/60 last:border-0 ${wallet.status === "archived" ? "text-text-muted" : ""}`}
              >
                <td className="py-1 pr-3">
                  <Link
                    href={`/wallets/${wallet.id}`}
                    className="underline decoration-border-strong underline-offset-2"
                  >
                    {wallet.label}
                  </Link>
                  {wallet.status === "archived" ? (
                    <span className="ml-1 font-mono text-[10px]">ARCHIVED</span>
                  ) : null}
                </td>
                <td className="py-1 pr-3">
                  <AddressText
                    value={wallet.address}
                    href={explorer.address(wallet.address)}
                    label={wallet.label}
                  />
                </td>
                <td className="py-1 pr-3">{CATEGORY_LABELS[wallet.category]}</td>
                <td className="py-1 pr-3">
                  <CustodyText wallet={wallet} localKeys={localKeys} />
                </td>
                <td className="py-1 pr-3 text-text-secondary">{wallet.tags.join(", ") || "—"}</td>
                <td className="py-1 pr-3 text-right">
                  <BalanceCell balances={balances} walletId={wallet.id} />
                </td>
                <td className="py-1">
                  <SyncStatus sync={wallet.sync} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <ul className="space-y-2 md:hidden">
        {rows.map(({ wallet, balances }) => (
          <li key={wallet.id} className="border-b border-border/60 pb-2 last:border-0">
            <Link href={`/wallets/${wallet.id}`} className="font-medium underline underline-offset-2">
              {wallet.label}
            </Link>
            <p className="text-[11px] text-text-secondary">
              {CATEGORY_LABELS[wallet.category]} · {CUSTODY_LABELS[wallet.custodyType]}
              {wallet.status === "archived" ? " · ARCHIVED" : ""}
            </p>
            <AddressText value={wallet.address} label={wallet.label} />
            <p className="text-[11px]">
              <BalanceCell balances={balances} walletId={wallet.id} />
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** SPEC-009 WRG-AC-15 — the organization's wallet registry. */
export function WalletRegistryView() {
  const { session, can, isPending: sessionPending } = useSession();
  const [status, setStatus] = useState<WalletStatus>("active");
  const [category, setCategory] = useState<WalletCategory | "">("");
  const [custodyType, setCustodyType] = useState<CustodyType | "">("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [registering, setRegistering] = useState<RegistrationMode | "local" | null>(null);
  const deferredTag = useDeferredValue(tag.trim().toLowerCase());
  const deferredSearch = useDeferredValue(search.trim());

  const filters: WalletFilters = {
    status,
    category: category || undefined,
    custodyType: custodyType || undefined,
    tag: /^[a-z0-9-]{1,32}$/.test(deferredTag) ? deferredTag : undefined,
    q: deferredSearch || undefined,
  };
  const allowed = session !== null && can("wallet.read");
  const list = useWalletList(filters, allowed);
  const pages = list.data?.pages.map((page) => page.data) ?? [];
  const firstBalances = pages[0]?.balances;
  const count = pages.reduce((total, page) => total + page.wallets.length, 0);
  const filtered =
    category !== "" || custodyType !== "" || filters.tag !== undefined || filters.q !== undefined;
  const error = list.error instanceof ApiRequestError ? list.error : null;

  if (sessionPending) return <LoadingState operation="Reading your session…" rows={2} />;
  if (!session) {
    return (
      <Panel title="Wallets">
        <p className="text-[12px] text-text-secondary">
          Sign in with a Devnet wallet to view the wallet registry.
        </p>
      </Panel>
    );
  }
  if (!can("wallet.read")) {
    return (
      <ErrorState title="You do not have permission to view wallets.">
        Your role does not include wallet.read. Ask an administrator for access.
      </ErrorState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[13px] font-semibold">Wallets</h1>
        {can("wallet.create") ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setRegistering("connected")}>Register connected wallet</Button>
            <Button onClick={() => setRegistering("local")}>Create local wallet</Button>
            <Button onClick={() => setRegistering("watch-only")}>Add watch-only address</Button>
          </div>
        ) : null}
      </div>

      {registering === "local" ? (
        <CreateLocalWalletPanel onClose={() => setRegistering(null)} />
      ) : registering ? (
        <RegisterWalletPanel mode={registering} onClose={() => setRegistering(null)} />
      ) : null}
      <UnregisteredKeysPanel canRegister={can("wallet.create")} />

      <Panel
        title={`Registered wallets (${count}${list.hasNextPage ? "+" : ""})`}
        aria-busy={list.isPending}
        actions={
          firstBalances && firstBalances.status !== "UNAVAILABLE" ? (
            <ProvenanceDetails provenance={firstBalances.provenance} label="SOL balances" />
          ) : null
        }
        footer={
          firstBalances && firstBalances.status !== "UNAVAILABLE" && count > 0 ? (
            <span className="flex flex-wrap gap-x-3">
              <FreshnessLabel
                retrievedAt={firstBalances.provenance.retrievedAt}
                staleAfterMs={OVERVIEW_STALE_AFTER_MS}
              />
              <span>
                Balances: {firstBalances.provenance.network} · {firstBalances.provenance.commitment ?? "—"}
              </span>
              <span>Devnet SOL has no market value. No USD valuation is shown.</span>
            </span>
          ) : undefined
        }
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Status filter</span>
            <Select value={status} onChange={(event) => setStatus(event.target.value as WalletStatus)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </label>
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Category filter</span>
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value as WalletCategory | "")}
            >
              <option value="">All categories</option>
              {WALLET_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Custody filter</span>
            <Select
              value={custodyType}
              onChange={(event) => setCustodyType(event.target.value as CustodyType | "")}
            >
              <option value="">All custody types</option>
              {CUSTODY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {CUSTODY_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Tag filter</span>
            <TextInput value={tag} onChange={(event) => setTag(event.target.value)} placeholder="e.g. ops" />
          </label>
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Search</span>
            <TextInput
              value={search}
              maxLength={64}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Label or address prefix"
            />
          </label>
        </div>

        {list.isPending ? (
          <LoadingState operation="Loading registered wallets…" rows={4} />
        ) : list.isError ? (
          <ErrorState
            title={error?.message ?? "The wallet registry could not be loaded."}
            requestId={error?.requestId}
          />
        ) : count === 0 ? (
          <EmptyState>
            {filtered || status === "archived"
              ? "No wallets match these filters."
              : "No wallets found. Create or connect a wallet to begin."}
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {firstBalances?.status === "UNAVAILABLE" ? (
              <DataUnavailable
                info={firstBalances.unavailable}
                onRetry={() => void list.refetch()}
                retrying={list.isRefetching}
              />
            ) : null}
            <WalletRows pages={pages} />
            {list.hasNextPage ? (
              <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? "Loading…" : "Load more wallets"}
              </Button>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
}
