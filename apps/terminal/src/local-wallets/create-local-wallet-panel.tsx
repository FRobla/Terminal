"use client";

import { AddressText, Button, ErrorState, FormField, LoadingState, Panel, TextInput } from "@sct/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useSession } from "../auth/use-session";
import { ApiRequestError } from "../platform/api-client";
import { publicConfig } from "../platform/public-config";
import { proveWalletControl, useRegisterWallet } from "../wallets/registry-api";
import {
  EMPTY_METADATA,
  metadataRequest,
  WalletMetadataFields,
  type WalletMetadataDraft,
} from "../wallets/wallet-metadata-fields";
import { WrongPassphraseError } from "./key-encryption";
import { passphraseProblem, type LocalKeyRecord } from "./local-key-record";
import { generateLocalKey, signMessageWith, withLocalSigner } from "./local-key-vault";
import { useEd25519Support, useSaveLocalKey } from "./use-local-keys";

export const CUSTODY_NOTICE =
  "This wallet's private key is generated and stored encrypted in this browser only. It is not institutional custody: the terminal and its operators cannot recover it. If you lose the passphrase or this browser's storage is cleared, the wallet and its funds are lost unless you exported the recovery file.";

type Step = "idle" | "generating" | "registering";

function describe(error: unknown): { title: string; requestId?: string | undefined } | null {
  if (!error) return null;
  if (error instanceof ApiRequestError) return { title: error.message, requestId: error.requestId };
  if (error instanceof WrongPassphraseError) return { title: error.message };
  if (error instanceof Error) return { title: error.message };
  return { title: "The local wallet could not be created." };
}

/**
 * Registers a stored local key: proves control with the key itself (passphrase
 * required) and registers the public address as LOCAL_ENCRYPTED (SPEC-010 §4.1, LWG-AC-08).
 */
export function useRegisterLocalKey() {
  const { session } = useSession();
  const register = useRegisterWallet();
  return async (record: LocalKeyRecord, passphrase: string, draft: WalletMetadataDraft) => {
    const ownership = await withLocalSigner(record, passphrase, (signer) =>
      proveWalletControl(record.address, (message) => signMessageWith(signer, message), session?.csrfToken),
    );
    return register.mutateAsync({
      custodyType: "LOCAL_ENCRYPTED",
      address: record.address,
      ...metadataRequest(draft),
      ownership,
    });
  };
}

export function PassphraseField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  help?: string;
  disabled?: boolean;
}) {
  return (
    <FormField id={props.id} label={props.label} help={props.help}>
      <TextInput
        id={props.id}
        type="password"
        value={props.value}
        autoComplete={props.autoComplete}
        spellCheck={false}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FormField>
  );
}

/** SPEC-010 §4.1 — LWG-AC-01, LWG-AC-02, LWG-AC-04, LWG-AC-10. */
export function CreateLocalWalletPanel(props: { onClose: () => void }) {
  const router = useRouter();
  const support = useEd25519Support();
  const saveKey = useSaveLocalKey();
  const registerKey = useRegisterLocalKey();
  const [acknowledged, setAcknowledged] = useState(false);
  const [draft, setDraft] = useState<WalletMetadataDraft>({ ...EMPTY_METADATA, category: "DEVELOPMENT" });
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [orphan, setOrphan] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const issue = passphraseProblem(passphrase, confirmation);
    setProblem(issue);
    if (issue) return;

    let record: LocalKeyRecord | null = null;
    let stored = false;
    try {
      setStep("generating");
      record = await generateLocalKey(passphrase, publicConfig.NEXT_PUBLIC_SOLANA_CLUSTER);
      await saveKey.mutateAsync(record);
      stored = true;
      setStep("registering");
      const wallet = await registerKey(record, passphrase, draft);
      setPassphrase("");
      setConfirmation("");
      router.push(`/wallets/${wallet.id}?created=local`);
    } catch (caught) {
      setError(caught);
      // LWG-AC-08: a stored key is never silently lost; it stays listed for registration.
      if (record && stored) setOrphan(record.address);
      setStep("idle");
    }
  };

  const failure = describe(error);
  const busy = step !== "idle";
  return (
    <Panel
      title="Create local wallet"
      actions={
        <Button variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      {support.isPending ? (
        <LoadingState operation="Checking Web Crypto support…" rows={1} />
      ) : !support.data ? (
        <ErrorState title="This browser cannot generate Ed25519 keys with Web Crypto.">
          Use a current version of Chrome, Edge, Firefox, or Safari.
        </ErrorState>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-3">
          <div className="rounded-[var(--radius-panel)] border border-warning/50 bg-warning/5 px-3 py-2 text-[12px]">
            <p className="font-semibold text-warning">Custody notice</p>
            <p className="mt-1">{CUSTODY_NOTICE}</p>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I understand that only I can recover this wallet.
            </label>
          </div>
          <WalletMetadataFields
            idPrefix="create-local"
            draft={draft}
            onChange={setDraft}
            allowWatchOnlyCategory={false}
            disabled={busy}
          />
          <PassphraseField
            id="create-local-passphrase"
            label="Passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="new-password"
            help="At least 12 characters. A long passphrase is the only protection if this browser's storage is copied."
            disabled={busy}
          />
          <PassphraseField
            id="create-local-confirmation"
            label="Confirm passphrase"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            disabled={busy}
          />
          {problem ? (
            <p role="alert" className="text-[12px] text-negative">
              {problem}
            </p>
          ) : null}
          {failure ? (
            <ErrorState title={failure.title} requestId={failure.requestId}>
              {orphan ? (
                <span>
                  The key for <AddressText value={orphan} label="Unregistered key" /> is stored in this
                  browser. Register it from <strong>Keys on this device not registered</strong>.
                </span>
              ) : null}
            </ErrorState>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !acknowledged || draft.label.trim() === ""}
          >
            {step === "generating"
              ? "Generating and encrypting the key…"
              : step === "registering"
                ? "Registering the wallet…"
                : "Create and register"}
          </Button>
        </form>
      )}
    </Panel>
  );
}
