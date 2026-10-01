"use client";

import { Button, ErrorState, FormField, Panel, TextInput } from "@sct/ui";
import { isAddress } from "@solana/kit";
import type { ManagedWallet } from "@sct/validation";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../platform/api-client";
import { parseSolToLamports } from "../wallets/sol-amount";
import { newIdempotencyKey, usePrepareTransfer } from "./transactions-api";

/** SPEC-004 amendment step 1 — the intent; the API builds, simulates, and reviews the transaction. */
export function TransferSolPanel(props: { wallet: ManagedWallet; onClose: () => void }) {
  const router = useRouter();
  const prepare = usePrepareTransfer();
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Kept across retries of the same form so a repeated click cannot create a second transfer.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const error = prepare.error instanceof ApiRequestError ? prepare.error : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const target = destination.trim();
    const lamports = parseSolToLamports(amount);
    if (!isAddress(target)) return setProblem("Enter a valid base58 Solana address.");
    if (target === props.wallet.address) return setProblem("The destination must differ from this wallet.");
    if (lamports === null || lamports <= 0n)
      return setProblem("Enter an amount in SOL with at most 9 decimals.");
    setProblem(null);
    prepare.mutate(
      { sourceWalletId: props.wallet.id, destination: target, lamports: lamports.toString(), idempotencyKey },
      {
        onSuccess: (record) => router.push(`/transactions/${record.id}`),
        onError: (caught) => {
          // A definitive refusal frees the key; a network failure keeps it for a safe retry.
          if (caught instanceof ApiRequestError && caught.status >= 400 && caught.status < 500) {
            setIdempotencyKey(newIdempotencyKey());
          }
        },
      },
    );
  };

  return (
    <Panel
      title="Transfer SOL"
      actions={
        <Button variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <p className="text-[12px] text-text-secondary">
          The terminal prepares and simulates the transfer on Devnet and shows a review before anything is
          signed.
        </p>
        <FormField id="transfer-destination" label="Destination address">
          <TextInput
            id="transfer-destination"
            value={destination}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onChange={(event) => setDestination(event.target.value)}
          />
        </FormField>
        <FormField id="transfer-amount" label="Amount (SOL)" help="Devnet SOL has no market value.">
          <TextInput
            id="transfer-amount"
            value={amount}
            inputMode="decimal"
            autoComplete="off"
            className="font-mono"
            onChange={(event) => setAmount(event.target.value)}
          />
        </FormField>
        {problem ? (
          <p role="alert" className="text-[12px] text-negative">
            {problem}
          </p>
        ) : null}
        {error ? <ErrorState title={error.message} requestId={error.requestId} /> : null}
        <Button type="submit" variant="primary" disabled={prepare.isPending}>
          {prepare.isPending ? "Preparing and simulating…" : "Review transfer"}
        </Button>
      </form>
    </Panel>
  );
}
