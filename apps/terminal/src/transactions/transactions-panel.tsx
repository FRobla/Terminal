"use client";

import { AddressText, EmptyState, ErrorState, LoadingState, Panel, ScrollRegion, Timestamp } from "@sct/ui";
import Link from "next/link";
import { ApiRequestError } from "../platform/api-client";
import { formatSol } from "../wallets/sol-amount";
import { StateBadge } from "./transaction-detail-view";
import { useTransactions } from "./transactions-api";

/** Transfers prepared in the terminal, newest first (SPEC-004 amendment, `wallet.read`). */
export function TransactionsPanel(props: { walletId: string | null; title?: string }) {
  const transactions = useTransactions(props.walletId, true);
  const error = transactions.error instanceof ApiRequestError ? transactions.error : null;
  const rows = transactions.data ?? [];
  return (
    <Panel title={props.title ?? "Transfers"}>
      {transactions.isPending ? (
        <LoadingState operation="Loading transfers…" rows={2} />
      ) : transactions.isError ? (
        <ErrorState title={error?.message ?? "Transfers could not be loaded."} requestId={error?.requestId} />
      ) : rows.length === 0 ? (
        <EmptyState>No transfers have been prepared{props.walletId ? " from this wallet" : ""}.</EmptyState>
      ) : (
        <ScrollRegion label="Transfers">
          <table className="w-full text-[12px]">
            <caption className="sr-only">Transfers, newest first</caption>
            <thead className="text-left text-[11px] text-text-muted uppercase">
              <tr className="border-b border-border">
                <th scope="col" className="py-1 pr-3 font-medium">
                  Prepared
                </th>
                {props.walletId ? null : (
                  <th scope="col" className="py-1 pr-3 font-medium">
                    From
                  </th>
                )}
                <th scope="col" className="py-1 pr-3 font-medium">
                  To
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="py-1 font-medium">
                  State
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((transaction) => (
                <tr key={transaction.id} className="border-b border-border/60 last:border-0">
                  <td className="py-1 pr-3">
                    <Link href={`/transactions/${transaction.id}`} className="underline underline-offset-2">
                      <Timestamp value={transaction.createdAt} />
                    </Link>
                  </td>
                  {props.walletId ? null : <td className="py-1 pr-3">{transaction.walletLabel}</td>}
                  <td className="py-1 pr-3">
                    <AddressText value={transaction.intent.destination} label="Destination" />
                  </td>
                  <td className="py-1 pr-3 text-right font-mono tabular">
                    {formatSol(transaction.intent.lamports)} SOL
                  </td>
                  <td className="py-1">
                    <StateBadge state={transaction.state} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Panel>
  );
}
