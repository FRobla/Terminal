"use client";

import { AddressText, Button, ErrorState, LoadingState, Panel, Timestamp } from "@sct/ui";
import type {
  ManagedWallet,
  TransactionRecordView,
  TransactionReview,
  TransactionState,
} from "@sct/validation";
import Link from "next/link";
import { useState } from "react";
import { useSession } from "../auth/use-session";
import { PassphraseField } from "../local-wallets/create-local-wallet-panel";
import { WrongPassphraseError } from "../local-wallets/key-encryption";
import { useLocalKeys } from "../local-wallets/use-local-keys";
import { useExplorerLinks } from "../network/use-explorer-links";
import { ApiRequestError } from "../platform/api-client";
import { useManagedWallet } from "../wallets/registry-api";
import { formatSol } from "../wallets/sol-amount";
import { useWalletClient } from "../wallets/wallet-client";
import { isSettled, useLifecycleCall, useTransaction } from "./transactions-api";
import { signWithConnectedWallet, signWithLocalKey, SigningUnavailableError } from "./wallet-signers";

const STATE_TEXT: Record<TransactionState, string> = {
  DRAFT: "Prepared",
  SIMULATING: "Simulating",
  SIMULATED: "Simulated",
  SIMULATION_FAILED: "Simulation failed",
  AWAITING_SIGNATURE: "Awaiting your signature",
  CANCELLED: "Cancelled",
  SIGNING: "Waiting for the wallet",
  SIGNING_FAILED: "Signing failed",
  SUBMITTED: "Submitted",
  SUBMISSION_FAILED: "Submission failed",
  CONFIRMING: "Confirming",
  EXPIRED: "Expired",
  CONFIRMATION_FAILED: "Failed on chain",
  CONFIRMED: "Confirmed, awaiting finalization",
  RECONCILED: "Reconciled",
  RECONCILIATION_REQUIRED: "Reconciliation required",
  RECONCILIATION_FAILED: "Reconciliation failed",
};

const NEGATIVE: readonly TransactionState[] = [
  "SIMULATION_FAILED",
  "SIGNING_FAILED",
  "SUBMISSION_FAILED",
  "EXPIRED",
  "CONFIRMATION_FAILED",
  "RECONCILIATION_REQUIRED",
  "RECONCILIATION_FAILED",
];

export function StateBadge(props: { state: TransactionState }) {
  const tone = NEGATIVE.includes(props.state)
    ? "text-negative"
    : props.state === "RECONCILED"
      ? "text-positive"
      : props.state === "CANCELLED"
        ? "text-text-muted"
        : "text-warning";
  return <span className={`font-mono text-[11px] ${tone}`}>{STATE_TEXT[props.state]}</span>;
}

function Movement(props: { delta: string }) {
  const negative = props.delta.startsWith("-");
  return (
    <span className={`font-mono tabular ${negative ? "text-negative" : "text-positive"}`}>
      {negative ? "" : "+"}
      {formatSol(props.delta)} SOL
    </span>
  );
}

/** TXL-AC-03 — the server-built review. */
function ReviewPanel(props: { review: TransactionReview }) {
  const { review } = props;
  const explorer = useExplorerLinks();
  return (
    <Panel title="Review">
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-text-secondary">Network</dt>
        <dd className="font-mono">SOLANA {review.cluster.toUpperCase()}</dd>
        <dt className="text-text-secondary">Fee payer</dt>
        <dd>
          <AddressText
            value={review.feePayer}
            href={explorer.address(review.feePayer)}
            label="Fee payer"
            full
          />
        </dd>
        <dt className="text-text-secondary">Signers</dt>
        <dd className="space-y-0.5">
          {review.signers.map((signer) => (
            <AddressText key={signer} value={signer} label="Signer" full />
          ))}
        </dd>
        <dt className="text-text-secondary">Programs</dt>
        <dd className="space-y-0.5">
          {review.programs.map((program) => (
            <p key={program.programId}>
              {program.known ? (
                <span>{program.name}</span>
              ) : (
                <span className="font-semibold text-negative">UNKNOWN PROGRAM</span>
              )}{" "}
              <span className="font-mono text-[11px] text-text-muted">{program.programId}</span>
            </p>
          ))}
        </dd>
        <dt className="text-text-secondary">Writable accounts</dt>
        <dd className="space-y-0.5">
          {review.accounts
            .filter((entry) => entry.writable)
            .map((entry) => (
              <AddressText key={entry.address} value={entry.address} label="Writable account" full />
            ))}
        </dd>
        <dt className="text-text-secondary">Balance changes</dt>
        <dd className="space-y-0.5">
          {review.movements.map((movement) => (
            <p key={movement.account} className="flex flex-wrap items-center gap-2">
              <AddressText value={movement.account} label="Account" />
              <Movement delta={movement.deltaLamports} />
            </p>
          ))}
        </dd>
        <dt className="text-text-secondary">Network fee</dt>
        <dd className="font-mono">
          {review.feeLamports === null
            ? "Unknown"
            : `${review.feeLamports} lamports (${formatSol(review.feeLamports)} SOL)`}
        </dd>
        <dt className="text-text-secondary">Simulation</dt>
        <dd>
          <span className={review.simulation.status === "SUCCEEDED" ? "text-positive" : "text-negative"}>
            {review.simulation.status === "SUCCEEDED" ? "Succeeded" : "Failed"}
          </span>
          {review.simulation.unitsConsumed ? (
            <span className="text-text-muted"> · {review.simulation.unitsConsumed} compute units</span>
          ) : null}
          {review.simulation.error ? (
            <span className="block font-mono text-[11px] break-all text-negative">
              {review.simulation.error}
            </span>
          ) : null}
        </dd>
        <dt className="text-text-secondary">Valid until block</dt>
        <dd className="font-mono">{review.lastValidBlockHeight}</dd>
      </dl>
      {review.simulation.logs.length > 0 ? (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-text-secondary">Simulation logs</summary>
          <pre
            className="mt-1 max-h-48 overflow-auto font-mono whitespace-pre-wrap text-text-muted"
            tabIndex={0}
          >
            {review.simulation.logs.join("\n")}
          </pre>
        </details>
      ) : null}
    </Panel>
  );
}

function describe(error: unknown): { title: string; requestId?: string | undefined } | null {
  if (!error) return null;
  if (error instanceof ApiRequestError) return { title: error.message, requestId: error.requestId };
  if (error instanceof Error) return { title: error.message };
  return { title: "The signature could not be completed." };
}

/** SPEC-004 amendment steps 6–7 — explicit confirmation, signature through the boundary, submission. */
function SignPanel(props: { record: TransactionRecordView; wallet: ManagedWallet }) {
  const { record, wallet } = props;
  const client = useWalletClient();
  const call = useLifecycleCall();
  const keys = useLocalKeys();
  const [acknowledged, setAcknowledged] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [pending, setPending] = useState<"signing" | "cancelling" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const review = record.review;
  const localRecord = keys.data?.find((entry) => entry.address === wallet.address);
  const isLocal = wallet.custodyType === "LOCAL_ENCRYPTED";
  const needsAck = review?.requiresUnknownProgramAcknowledgement ?? false;

  const sign = async () => {
    if (!record.unsignedTransactionBase64) return;
    setPending("signing");
    setError(null);
    const base = `/transactions/${encodeURIComponent(record.id)}`;
    try {
      const signing =
        record.state === "SIGNING"
          ? record
          : await call(`${base}/signing`, { acknowledgeUnknownPrograms: acknowledged });
      let signed: string;
      try {
        if (isLocal) {
          if (!localRecord)
            throw new SigningUnavailableError("This wallet's key is not stored in this browser.");
          signed = await signWithLocalKey(localRecord, passphrase, signing.unsignedTransactionBase64 ?? "");
        } else {
          signed = await signWithConnectedWallet(
            client,
            wallet.address,
            signing.unsignedTransactionBase64 ?? "",
          );
        }
      } catch (caught) {
        if (caught instanceof WrongPassphraseError) {
          // Nothing was signed; the user may try the passphrase again.
          setError(caught);
          return;
        }
        const reason =
          caught instanceof SigningUnavailableError
            ? "UNSUPPORTED_WALLET"
            : caught instanceof Error && /reject|declin|cancel/i.test(caught.message)
              ? "USER_REJECTED"
              : "WALLET_ERROR";
        await call(`${base}/signing-failed`, { reason });
        throw caught;
      }
      setPassphrase("");
      await call(`${base}/submit`, { signedTransactionBase64: signed });
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(null);
    }
  };

  const cancel = async () => {
    setPending("cancelling");
    setError(null);
    try {
      await call(`/transactions/${encodeURIComponent(record.id)}/cancel`);
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(null);
    }
  };

  const failure = describe(error);
  return (
    <Panel title="Sign">
      <div className="space-y-3 text-[12px]">
        <p className="text-text-secondary">
          {isLocal
            ? "Enter the passphrase of this local wallet. The key is decrypted only for this signature."
            : "Your wallet will ask you to approve exactly this transaction."}
        </p>
        {needsAck ? (
          <label className="flex items-center gap-2 text-negative">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I reviewed the unknown programs above and still want to sign.
          </label>
        ) : null}
        {isLocal ? (
          localRecord ? (
            <PassphraseField
              id="sign-passphrase"
              label="Passphrase"
              value={passphrase}
              onChange={setPassphrase}
              autoComplete="current-password"
              disabled={pending !== null}
            />
          ) : (
            <ErrorState title="Key not on this device">
              This local wallet was generated in another browser. Sign there, or cancel.
            </ErrorState>
          )
        ) : null}
        {failure ? <ErrorState title={failure.title} requestId={failure.requestId} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => void sign()}
            disabled={
              pending !== null ||
              (needsAck && !acknowledged) ||
              (isLocal && (!localRecord || passphrase === ""))
            }
          >
            {pending === "signing" ? "Waiting for signature…" : "Sign and submit"}
          </Button>
          {record.state === "AWAITING_SIGNATURE" ? (
            <Button variant="ghost" onClick={() => void cancel()} disabled={pending !== null}>
              {pending === "cancelling" ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

/** TXL-AC-14 — the persisted state history, newest last. */
function TimelinePanel(props: { record: TransactionRecordView }) {
  const explorer = useExplorerLinks();
  const { record } = props;
  return (
    <Panel title="Lifecycle">
      <ol className="space-y-1 text-[12px]" aria-label="Transaction state history">
        {record.stateHistory.map((change, index) => (
          <li key={`${change.to}-${index}`} className="flex flex-wrap items-center gap-2">
            <StateBadge state={change.to} />
            <span className="text-text-muted">
              <Timestamp value={change.at} />
            </span>
            {typeof change.details.reason === "string" ? (
              <span className="font-mono text-[11px] text-text-muted">{change.details.reason}</span>
            ) : null}
          </li>
        ))}
      </ol>
      {record.signature ? (
        <p className="mt-2 text-[12px]">
          Signature:{" "}
          <AddressText
            value={record.signature}
            href={explorer.transaction(record.signature)}
            label="Signature"
          />
        </p>
      ) : null}
      {record.failure ? (
        <p className="mt-2 text-[12px] text-negative">
          {record.failure.message} <span className="font-mono text-[11px]">({record.failure.reason})</span>
        </p>
      ) : null}
      {record.reconciliation ? (
        <div className="mt-2 text-[12px]">
          <p className={record.reconciliation.matched ? "text-positive" : "text-negative"}>
            {record.reconciliation.matched
              ? "Finalized balances match the expected changes."
              : "Finalized balances differ from the expected changes."}
          </p>
          {!record.reconciliation.matched
            ? record.reconciliation.observed.map((movement) => (
                <p key={movement.account} className="flex flex-wrap gap-2">
                  <AddressText value={movement.account} label="Account" /> observed{" "}
                  <Movement delta={movement.deltaLamports} />
                </p>
              ))
            : null}
        </div>
      ) : null}
      {!isSettled(record.state) && record.state !== "AWAITING_SIGNATURE" ? (
        <p role="status" className="mt-2 text-[11px] text-text-muted">
          Updating every 2 s while the worker tracks the transaction.
        </p>
      ) : null}
    </Panel>
  );
}

export function TransactionDetailView(props: { transactionId: string }) {
  const { session, can, isPending: sessionPending } = useSession();
  const allowed = session !== null && can("wallet.read");
  const transaction = useTransaction(props.transactionId, allowed);
  const wallet = useManagedWallet(
    transaction.data?.walletId ?? "",
    allowed && transaction.data !== undefined,
  );
  const error = transaction.error instanceof ApiRequestError ? transaction.error : null;

  if (sessionPending) return <LoadingState operation="Reading your session…" rows={2} />;
  if (!session) {
    return (
      <Panel title="Transaction">
        <p className="text-[12px] text-text-secondary">
          Sign in with a Devnet wallet to view this transaction.
        </p>
      </Panel>
    );
  }
  if (!allowed) return <ErrorState title="You do not have permission to view transactions." />;
  if (transaction.isPending) return <LoadingState operation="Loading the transaction…" rows={3} />;
  if (!transaction.data) {
    return (
      <ErrorState
        title={error?.message ?? "The transaction could not be loaded."}
        requestId={error?.requestId}
      />
    );
  }
  const record = transaction.data;
  const mine = record.initiatedBy.id === session.user.id;
  const awaiting = record.state === "AWAITING_SIGNATURE" || record.state === "SIGNING";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-[11px] text-text-muted">
          <Link href={`/wallets/${record.walletId}`} className="underline">
            {record.walletLabel || "Wallet"}
          </Link>{" "}
          / Transfer
        </p>
        <h1 className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          Transfer {formatSol(record.intent.lamports)} SOL <StateBadge state={record.state} />
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
          to <AddressText value={record.intent.destination} label="Destination" full />
        </p>
      </div>
      {record.review ? <ReviewPanel review={record.review} /> : null}
      {awaiting && mine && can("wallet.control") && wallet.data ? (
        <SignPanel record={record} wallet={wallet.data} />
      ) : awaiting && !mine ? (
        <p className="text-[12px] text-text-secondary">
          Only the person who prepared this transfer can sign it.
        </p>
      ) : null}
      <TimelinePanel record={record} />
    </div>
  );
}
