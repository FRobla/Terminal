"use client";

import {
  AddressText,
  Button,
  ConfirmAction,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  SaveStatus,
  ScrollRegion,
  Select,
  Timestamp,
} from "@sct/ui";
import { WALLET_ROLES, type IndexedTransaction, type ManagedWallet, type WalletRole } from "@sct/validation";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LocalKeyPanel } from "../local-wallets/local-key-panel";
import { TransactionsPanel } from "../transactions/transactions-panel";
import { TransferSolPanel } from "../transactions/transfer-sol-panel";
import { useState } from "react";
import { useSession } from "../auth/use-session";
import { useExplorerLinks } from "../network/use-explorer-links";
import { ApiRequestError } from "../platform/api-client";
import { SolBalancePanel, TokenAccountsPanel } from "./overview-panels";
import {
  useAssignmentChange,
  useManagedWallet,
  useOrganizationMembers,
  useRequestSync,
  useUpdateWallet,
  useWalletHistory,
} from "./registry-api";
import { CATEGORY_LABELS, CUSTODY_LABELS, ROLE_LABELS } from "./registry-labels";
import { formatSol } from "./sol-amount";
import { useWalletOverview } from "./use-wallet-overview";
import { metadataRequest, WalletMetadataFields, type WalletMetadataDraft } from "./wallet-metadata-fields";
import { SyncStatus } from "./wallet-registry-view";

const MEMO_DISPLAY_LIMIT = 256;

function errorOf(error: unknown) {
  return error instanceof ApiRequestError ? error : null;
}

function draftOf(wallet: ManagedWallet): WalletMetadataDraft {
  return {
    label: wallet.label,
    category: wallet.category,
    purpose: wallet.purpose ?? "",
    tags: wallet.tags.join(", "),
    notes: wallet.notes ?? "",
  };
}

function DetailsPanel(props: { wallet: ManagedWallet; canEdit: boolean }) {
  const { wallet } = props;
  const update = useUpdateWallet(wallet.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(wallet));
  const error = errorOf(update.error);

  return (
    <Panel
      title="Details"
      actions={
        props.canEdit && !editing ? (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(draftOf(wallet));
              update.reset();
              setEditing(true);
            }}
          >
            Edit
          </Button>
        ) : null
      }
    >
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(metadataRequest(draft), { onSuccess: () => setEditing(false) });
          }}
        >
          <WalletMetadataFields
            idPrefix="edit-wallet"
            draft={draft}
            onChange={setDraft}
            allowWatchOnlyCategory={wallet.custodyType === "WATCH_ONLY"}
            disabled={update.isPending}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={update.isPending || draft.label.trim() === ""}>
              Save changes
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <SaveStatus
              state={update.isPending ? "saving" : update.isError ? "error" : "idle"}
              error={error?.message}
            />
          </div>
        </form>
      ) : (
        <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-text-secondary">Category</dt>
          <dd>{CATEGORY_LABELS[wallet.category]}</dd>
          <dt className="text-text-secondary">Custody</dt>
          <dd>{CUSTODY_LABELS[wallet.custodyType]}</dd>
          <dt className="text-text-secondary">Purpose</dt>
          <dd>{wallet.purpose ?? <span className="text-text-muted">—</span>}</dd>
          <dt className="text-text-secondary">Tags</dt>
          <dd>{wallet.tags.join(", ") || <span className="text-text-muted">—</span>}</dd>
          <dt className="text-text-secondary">Notes</dt>
          <dd className="whitespace-pre-wrap">
            {wallet.notes ?? <span className="text-text-muted">—</span>}
          </dd>
          <dt className="text-text-secondary">Registered</dt>
          <dd>
            <Timestamp value={wallet.createdAt} /> by{" "}
            {wallet.createdBy.displayName ?? "a member without a display name"}
          </dd>
          <dt className="text-text-secondary">Status</dt>
          <dd>
            {wallet.status === "archived" ? (
              <>Archived {wallet.archivedAt ? <Timestamp value={wallet.archivedAt} /> : null}</>
            ) : (
              "Active"
            )}
          </dd>
        </dl>
      )}
      {props.canEdit && !editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {wallet.status === "active" ? (
            <ConfirmAction
              label="Archive wallet"
              consequence="Hides it from the default list and stops synchronization. History and assignments are kept."
              pending={update.isPending}
              onConfirm={() => update.mutate({ status: "archived" })}
            />
          ) : (
            <Button onClick={() => update.mutate({ status: "active" })} disabled={update.isPending}>
              Restore wallet
            </Button>
          )}
          {error && !editing ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
        </div>
      ) : null}
    </Panel>
  );
}

function AssignmentsPanel(props: { wallet: ManagedWallet; canManage: boolean }) {
  const { wallet } = props;
  const members = useOrganizationMembers(props.canManage);
  const change = useAssignmentChange(wallet.id);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<WalletRole>("VIEWER");
  const error = errorOf(change.error);

  return (
    <Panel title="Assignments">
      <p className="mb-2 text-[11px] text-text-muted">
        Application roles on this wallet. They are not Solana protocol authorities. Creators and controllers
        may initiate transactions from it.
      </p>
      {wallet.assignments.length === 0 ? (
        <EmptyState>No one is assigned to this wallet.</EmptyState>
      ) : (
        <ul className="space-y-1 text-[12px]">
          {wallet.assignments.map((assignment) => (
            <li key={`${assignment.userId}-${assignment.role}`} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{ROLE_LABELS[assignment.role]}</span>
              <span>{assignment.displayName ?? "No display name"}</span>
              {assignment.walletAddress ? (
                <AddressText value={assignment.walletAddress} label="Member wallet" />
              ) : null}
              {props.canManage ? (
                <Button
                  variant="ghost"
                  disabled={change.isPending}
                  onClick={() =>
                    change.mutate({ operation: "unassign", userId: assignment.userId, role: assignment.role })
                  }
                  aria-label={`Remove ${ROLE_LABELS[assignment.role]} role from ${assignment.displayName ?? "member"}`}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {props.canManage ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (userId) change.mutate({ operation: "assign", userId, role });
          }}
        >
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Member</span>
            <Select value={userId} onChange={(event) => setUserId(event.target.value)} className="!w-56">
              <option value="">{members.isPending ? "Loading members…" : "Choose a member"}</option>
              {members.data?.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName ?? member.walletAddress ?? member.userId}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-[11px] text-text-secondary">
            <span>Role</span>
            <Select
              value={role}
              onChange={(event) => setRole(event.target.value as WalletRole)}
              className="!w-36"
            >
              {WALLET_ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" disabled={!userId || change.isPending}>
            Assign
          </Button>
        </form>
      ) : null}
      {error ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
    </Panel>
  );
}

function Memo(props: { memo: string | null }) {
  if (props.memo === null) return <span className="text-text-muted">—</span>;
  // Untrusted on-chain text: plain text only, truncated (WO-AC-17).
  const truncated = props.memo.length > MEMO_DISPLAY_LIMIT;
  return (
    <span className="break-all text-text-secondary" title={props.memo}>
      {truncated ? `${props.memo.slice(0, MEMO_DISPLAY_LIMIT)}…` : props.memo}
    </span>
  );
}

function SolChange(props: { transaction: IndexedTransaction }) {
  const change = props.transaction.solChangeLamports;
  if (change === null) return <span className="text-text-muted">Not yet indexed</span>;
  const negative = change.startsWith("-");
  return (
    <span
      className={`font-mono tabular ${negative ? "text-negative" : change === "0" ? "" : "text-positive"}`}
    >
      {negative || change === "0" ? "" : "+"}
      {formatSol(change)}
    </span>
  );
}

/** WRG-AC-13 — the wallet's indexed history with coverage and sync state. */
function HistoryPanel(props: { wallet: ManagedWallet }) {
  const history = useWalletHistory(props.wallet.id, true);
  const sync = useRequestSync(props.wallet.id);
  const explorer = useExplorerLinks();
  const pages = history.data?.pages.map((page) => page.data) ?? [];
  const transactions = pages.flatMap((page) => page.transactions);
  const syncState = pages[0]?.sync ?? props.wallet.sync;
  const cap = pages[0]?.backfillCap;
  const error = errorOf(history.error);
  const syncResult = sync.data;

  return (
    <Panel
      title="Indexed history"
      aria-busy={history.isPending}
      actions={
        props.wallet.status === "active" ? (
          <Button variant="ghost" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Requesting…" : "Sync now"}
          </Button>
        ) : null
      }
      footer={
        <span className="flex flex-wrap gap-x-3">
          <SyncStatus sync={syncState} />
          {syncState.oldestIndexedBlockTime ? (
            <span>
              Indexed since <Timestamp value={syncState.oldestIndexedBlockTime} />
            </span>
          ) : null}
          {syncState.backfillComplete && cap !== undefined && syncState.indexedCount >= cap ? (
            <span>Older history is not indexed.</span>
          ) : null}
          <span>Source: worker index of Devnet RPC data</span>
        </span>
      }
    >
      {syncResult ? (
        <p role="status" className="mb-2 text-[11px] text-text-secondary">
          {syncResult.enqueued
            ? "Synchronization requested. New transactions appear within a minute."
            : syncResult.retryAfterMs !== null
              ? `A sync was requested recently. Try again in ${Math.ceil(syncResult.retryAfterMs / 1000)} s.`
              : "Archived wallets are not synchronized."}
        </p>
      ) : null}
      {sync.error ? <ErrorState title={errorOf(sync.error)?.message ?? "The sync request failed."} /> : null}
      {history.isPending ? (
        <LoadingState operation="Loading indexed transactions…" rows={4} />
      ) : history.isError ? (
        <ErrorState
          title={error?.message ?? "The history could not be loaded."}
          requestId={error?.requestId}
        />
      ) : transactions.length === 0 ? (
        <EmptyState>
          {syncState.lastSuccessAt
            ? "No indexed transactions are available for this wallet."
            : "This wallet has not been indexed yet."}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          <ScrollRegion label="Indexed transactions">
            <table className="w-full text-[12px]">
              <caption className="sr-only">Indexed transactions, newest first</caption>
              <thead className="text-left text-[11px] text-text-muted uppercase">
                <tr className="border-b border-border">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Signature
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Block time
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    SOL change
                  </th>
                  <th scope="col" className="py-1 pr-3 text-right font-medium">
                    Fee (lamports)
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Memo
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.signature} className="border-b border-border/60 last:border-0">
                    <td className="py-1 pr-3">
                      <AddressText
                        value={transaction.signature}
                        href={explorer.transaction(transaction.signature)}
                        label="Signature"
                      />
                    </td>
                    <td className="py-1 pr-3 font-mono text-text-secondary">
                      {transaction.blockTime ? <Timestamp value={transaction.blockTime} /> : "Unknown"}
                      <span className="block text-[10px] text-text-muted">slot {transaction.slot}</span>
                    </td>
                    <td className={`py-1 pr-3 ${transaction.status === "failed" ? "text-negative" : ""}`}>
                      {transaction.status}
                    </td>
                    <td className="py-1 pr-3 text-right">
                      <SolChange transaction={transaction} />
                    </td>
                    <td className="py-1 pr-3 text-right font-mono tabular text-text-secondary">
                      {transaction.feeLamports ?? "—"}
                    </td>
                    <td className="max-w-[220px] py-1">
                      <Memo memo={transaction.memo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          {history.hasNextPage ? (
            <Button onClick={() => void history.fetchNextPage()} disabled={history.isFetchingNextPage}>
              {history.isFetchingNextPage ? "Loading…" : "Load older transactions"}
            </Button>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/** TXL-AC-10 (UX only; the API enforces it): an active, controlled wallet the user may move funds from. */
function canTransfer(wallet: ManagedWallet, hasControlPermission: boolean): boolean {
  return (
    hasControlPermission &&
    wallet.status === "active" &&
    wallet.custodyType !== "WATCH_ONLY" &&
    wallet.myRoles.some((role) => role === "CREATOR" || role === "CONTROLLER")
  );
}

/** SPEC-009 §4.4 — one registered wallet: metadata, assignments, live overview, and indexed history. */
export function WalletDetailView(props: { walletId: string }) {
  const { session, can, isPending: sessionPending } = useSession();
  const allowed = session !== null && can("wallet.read");
  const wallet = useManagedWallet(props.walletId, allowed);
  const address = wallet.data?.address ?? null;
  const overview = useWalletOverview(address, allowed && address !== null);
  const explorer = useExplorerLinks();
  const searchParams = useSearchParams();
  const [transferring, setTransferring] = useState(false);
  const error = errorOf(wallet.error);

  if (sessionPending) return <LoadingState operation="Reading your session…" rows={2} />;
  if (!session) {
    return (
      <Panel title="Wallet">
        <p className="text-[12px] text-text-secondary">Sign in with a Devnet wallet to view this wallet.</p>
      </Panel>
    );
  }
  if (!allowed) return <ErrorState title="You do not have permission to view wallets." />;
  if (wallet.isPending) return <LoadingState operation="Loading the wallet…" rows={3} />;
  if (wallet.isError || !wallet.data) {
    return (
      <ErrorState
        title={
          error?.code === "WALLET_NOT_FOUND"
            ? "This wallet is not registered in your organization."
            : (error?.message ?? "The wallet could not be loaded.")
        }
        requestId={error?.requestId}
        action={
          <Link href="/wallets" className="underline">
            Back to wallets
          </Link>
        }
      />
    );
  }

  const data = wallet.data;
  const retry = () => void overview.refetch();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] text-text-muted">
            <Link href="/wallets" className="underline">
              Wallets
            </Link>{" "}
            / {CATEGORY_LABELS[data.category]}
          </p>
          <h1 className="text-[13px] font-semibold">
            {data.label}
            {data.status === "archived" ? (
              <span className="ml-2 font-mono text-[10px] text-text-muted">ARCHIVED</span>
            ) : null}
          </h1>
          <AddressText value={data.address} href={explorer.address(data.address)} label={data.label} full />
        </div>
        <div className="flex flex-wrap gap-2">
          {canTransfer(data, can("wallet.control")) ? (
            <Button variant="primary" onClick={() => setTransferring(true)}>
              Transfer SOL
            </Button>
          ) : null}
          <Button onClick={retry} disabled={overview.isFetching}>
            {overview.isFetching ? "Refreshing…" : "Refresh balances"}
          </Button>
        </div>
      </div>
      {transferring ? <TransferSolPanel wallet={data} onClose={() => setTransferring(false)} /> : null}

      <div className="grid gap-3 xl:grid-cols-[320px_1fr]">
        <SolBalancePanel overview={overview.data} onRetry={retry} retrying={overview.isFetching} />
        <TokenAccountsPanel overview={overview.data} onRetry={retry} retrying={overview.isFetching} />
      </div>
      {data.custodyType === "LOCAL_ENCRYPTED" ? (
        <LocalKeyPanel wallet={data} justCreated={searchParams.get("created") === "local"} />
      ) : null}
      <TransactionsPanel walletId={data.id} />
      <HistoryPanel wallet={data} />
      <div className="grid gap-3 lg:grid-cols-2">
        <DetailsPanel key={data.updatedAt} wallet={data} canEdit={can("wallet.create")} />
        <AssignmentsPanel wallet={data} canManage={can("organization.manage")} />
      </div>
    </div>
  );
}
