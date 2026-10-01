"use client";

import type { RecentTransaction, TokenAccount, WalletOverview } from "@sct/validation";
import { AddressText, EmptyState } from "@sct/ui";
import { SourcedPanel } from "./sourced-panel";

const MEMO_DISPLAY_LIMIT = 256;

/** Pads the fractional part to the asset's decimals for aligned, exact display. */
function formatExact(uiAmount: string, decimals: number): string {
  const [whole = "0", fraction = ""] = uiAmount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals > 0 ? `${grouped}.${fraction.padEnd(decimals, "0")}` : grouped;
}

interface PanelProps {
  overview: WalletOverview | undefined;
  onRetry: () => void;
  retrying: boolean;
}

export function SolBalancePanel(props: PanelProps) {
  return (
    <SourcedPanel
      title="SOL balance"
      sourced={props.overview?.solBalance}
      loadingOperation="Fetching SOL balance from the Devnet RPC…"
      onRetry={props.onRetry}
      retrying={props.retrying}
    >
      {(balance) => (
        <div>
          <p className="font-mono text-2xl tabular" data-testid="sol-balance">
            {formatExact(balance.uiAmount, balance.decimals)}{" "}
            <span className="text-sm text-text-secondary">SOL</span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-text-muted tabular">{balance.lamports} lamports</p>
          <p className="mt-2 text-[11px] text-text-muted">
            Devnet SOL has no market value. No USD valuation is shown.
          </p>
        </div>
      )}
    </SourcedPanel>
  );
}

function TokenAccountRows(props: { accounts: TokenAccount[] }) {
  if (props.accounts.length === 0) {
    return <EmptyState>No token accounts found for this wallet on Devnet.</EmptyState>;
  }
  return (
    <>
      <table className="hidden w-full text-[12px] md:table">
        <caption className="sr-only">Token accounts for SPL Token and Token-2022</caption>
        <thead className="text-left text-[11px] text-text-muted uppercase">
          <tr className="border-b border-border">
            <th scope="col" className="py-1 pr-3 font-medium">
              Mint
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Program
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Decimals
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              State
            </th>
            <th scope="col" className="py-1 font-medium">
              Token account
            </th>
          </tr>
        </thead>
        <tbody>
          {props.accounts.map((account) => (
            <tr key={account.tokenAccount} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-3">
                <AddressText value={account.mint} label="Mint" />
              </td>
              <td className="py-1 pr-3 font-mono text-text-secondary">{account.tokenProgram}</td>
              <td className="py-1 pr-3 text-right font-mono tabular">
                {formatExact(account.uiAmount, account.decimals)}
              </td>
              <td className="py-1 pr-3 text-right font-mono tabular text-text-secondary">
                {account.decimals}
              </td>
              <td
                className={`py-1 pr-3 ${account.state === "frozen" ? "text-warning" : "text-text-secondary"}`}
              >
                {account.state}
              </td>
              <td className="py-1">
                <AddressText value={account.tokenAccount} label="Token account" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 md:hidden">
        {props.accounts.map((account) => (
          <li key={account.tokenAccount} className="border-b border-border/60 pb-2 last:border-0">
            <p className="font-mono tabular">{formatExact(account.uiAmount, account.decimals)}</p>
            <p className="text-[11px] text-text-secondary">
              Mint <AddressText value={account.mint} label="Mint" /> · {account.tokenProgram} ·{" "}
              {account.state}
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-text-muted">
        Mints are shown by address. Token metadata and market prices are not available in this release.
      </p>
    </>
  );
}

export function TokenAccountsPanel(props: PanelProps) {
  return (
    <SourcedPanel
      title="Token accounts"
      sourced={props.overview?.tokenAccounts}
      loadingOperation="Fetching SPL Token and Token-2022 accounts from the Devnet RPC…"
      onRetry={props.onRetry}
      retrying={props.retrying}
    >
      {(accounts) => <TokenAccountRows accounts={accounts} />}
    </SourcedPanel>
  );
}

function Memo(props: { memo: string | null }) {
  if (props.memo === null) return <span className="text-text-muted">—</span>;
  const truncated = props.memo.length > MEMO_DISPLAY_LIMIT;
  // WO-AC-17: untrusted text is rendered as plain text only.
  return (
    <span className="break-all text-text-secondary" title={props.memo}>
      {truncated ? `${props.memo.slice(0, MEMO_DISPLAY_LIMIT)}…` : props.memo}
    </span>
  );
}

function TransactionRows(props: { transactions: RecentTransaction[] }) {
  if (props.transactions.length === 0) {
    return <EmptyState>No indexed transactions are available for this wallet.</EmptyState>;
  }
  return (
    <>
      <table className="hidden w-full text-[12px] md:table">
        <caption className="sr-only">Recent transaction signatures, newest first</caption>
        <thead className="text-left text-[11px] text-text-muted uppercase">
          <tr className="border-b border-border">
            <th scope="col" className="py-1 pr-3 font-medium">
              Signature
            </th>
            <th scope="col" className="py-1 pr-3 text-right font-medium">
              Slot
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Block time (UTC)
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              Status
            </th>
            <th scope="col" className="py-1 font-medium">
              Memo
            </th>
          </tr>
        </thead>
        <tbody>
          {props.transactions.map((transaction) => (
            <tr key={transaction.signature} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-3">
                <AddressText value={transaction.signature} href={transaction.explorerUrl} label="Signature" />
              </td>
              <td className="py-1 pr-3 text-right font-mono tabular text-text-secondary">
                {transaction.slot}
              </td>
              <td className="py-1 pr-3 font-mono text-text-secondary">
                {transaction.blockTime
                  ? transaction.blockTime.replace("T", " ").replace(".000Z", "")
                  : "Unknown"}
              </td>
              <td
                className={`py-1 pr-3 ${transaction.status === "failed" ? "text-negative" : "text-text-primary"}`}
              >
                {transaction.status}
                {transaction.confirmationStatus ? (
                  <span className="text-text-muted"> · {transaction.confirmationStatus}</span>
                ) : null}
              </td>
              <td className="max-w-[260px] py-1">
                <Memo memo={transaction.memo} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-2 md:hidden">
        {props.transactions.map((transaction) => (
          <li key={transaction.signature} className="border-b border-border/60 pb-2 last:border-0">
            <AddressText value={transaction.signature} href={transaction.explorerUrl} label="Signature" />
            <p
              className={`text-[11px] ${transaction.status === "failed" ? "text-negative" : "text-text-secondary"}`}
            >
              {transaction.status} · slot {transaction.slot} · {transaction.blockTime ?? "Unknown time"}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RecentTransactionsPanel(props: PanelProps) {
  return (
    <SourcedPanel
      title="Recent transactions"
      sourced={props.overview?.recentTransactions}
      loadingOperation="Fetching recent signatures from the Devnet RPC…"
      onRetry={props.onRetry}
      retrying={props.retrying}
    >
      {(transactions) => <TransactionRows transactions={transactions} />}
    </SourcedPanel>
  );
}
