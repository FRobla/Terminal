"use client";

import {
  transactionRecordSchema,
  type SolTransferRequest,
  type TransactionRecordView,
  type TransactionState,
} from "@sct/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../auth/use-session";
import { apiRequest } from "../platform/api-client";

/** SPEC-004 — transaction queries and lifecycle calls. Keys start with "wallets" (cleared on sign-out). */

const TERMINAL: readonly TransactionState[] = [
  "SIMULATION_FAILED",
  "CANCELLED",
  "SIGNING_FAILED",
  "SUBMISSION_FAILED",
  "EXPIRED",
  "CONFIRMATION_FAILED",
  "RECONCILED",
  "RECONCILIATION_FAILED",
];

export function isSettled(state: TransactionState): boolean {
  return TERMINAL.includes(state);
}

const transactionKey = (id: string) => ["wallets", "transactions", "detail", id] as const;

/** Polls every 2 s while the worker is still moving the transaction. */
export function useTransaction(transactionId: string, enabled: boolean) {
  return useQuery({
    queryKey: transactionKey(transactionId),
    queryFn: ({ signal }) =>
      apiRequest(`/transactions/${encodeURIComponent(transactionId)}`, transactionRecordSchema, { signal }),
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state && !isSettled(state) && state !== "AWAITING_SIGNATURE" ? 2_000 : false;
    },
  });
}

export function useTransactions(walletId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["wallets", "transactions", "list", walletId],
    queryFn: ({ signal }) =>
      apiRequest(
        `/transactions?limit=25${walletId ? `&walletId=${encodeURIComponent(walletId)}` : ""}`,
        z.array(transactionRecordSchema),
        { signal },
      ),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.some((transaction) => !isSettled(transaction.state)) ? 5_000 : false,
  });
}

/** One lifecycle call with the session's CSRF token; the result replaces the cached record. */
export function useLifecycleCall() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  return async (path: string, body?: unknown): Promise<TransactionRecordView> => {
    const record = await apiRequest(path, transactionRecordSchema, {
      method: "POST",
      csrfToken: session?.csrfToken,
      ...(body !== undefined ? { body } : {}),
    });
    queryClient.setQueryData(transactionKey(record.id), record);
    void queryClient.invalidateQueries({ queryKey: ["wallets", "transactions", "list"] });
    return record;
  };
}

export function usePrepareTransfer() {
  const call = useLifecycleCall();
  return useMutation({
    mutationFn: (request: SolTransferRequest) => call("/transactions/sol-transfers", request),
  });
}

/** A fresh idempotency key per form submission; a retried request reuses it. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `sct-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
