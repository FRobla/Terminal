"use client";

import { AddressText, Button, ErrorState, Panel, Timestamp } from "@sct/ui";
import { walletListSchema } from "@sct/validation";
import { useQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiRequestError, apiRequest } from "../platform/api-client";
import {
  EMPTY_METADATA,
  WalletMetadataFields,
  type WalletMetadataDraft,
} from "../wallets/wallet-metadata-fields";
import { PassphraseField, useRegisterLocalKey } from "./create-local-wallet-panel";
import type { LocalKeyRecord } from "./local-key-record";
import { useLocalKeys } from "./use-local-keys";

/** Whether an address is registered in the organization, active or archived. */
function useRegistrationStatus(records: LocalKeyRecord[]) {
  return useQueries({
    queries: records.map((record) => ({
      queryKey: ["wallets", "registry", "registered", record.address],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const [active, archived] = await Promise.all(
          (["active", "archived"] as const).map((status) =>
            apiRequest(
              `/wallets?status=${status}&q=${encodeURIComponent(record.address)}&limit=1`,
              walletListSchema,
              {
                signal,
              },
            ),
          ),
        );
        return [...(active?.wallets ?? []), ...(archived?.wallets ?? [])].some(
          (wallet) => wallet.address === record.address,
        );
      },
    })),
  });
}

function RegisterKeyForm(props: { record: LocalKeyRecord; onDone: (walletId: string) => void }) {
  const registerKey = useRegisterLocalKey();
  const [draft, setDraft] = useState<WalletMetadataDraft>({ ...EMPTY_METADATA, category: "DEVELOPMENT" });
  const [passphrase, setPassphrase] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const failure =
    error instanceof ApiRequestError
      ? { title: error.message, requestId: error.requestId }
      : error instanceof Error
        ? { title: error.message, requestId: undefined }
        : null;

  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        registerKey(props.record, passphrase, draft)
          .then((wallet) => {
            setPassphrase("");
            props.onDone(wallet.id);
          })
          .catch(setError)
          .finally(() => setPending(false));
      }}
    >
      <WalletMetadataFields
        idPrefix={`register-key-${props.record.address}`}
        draft={draft}
        onChange={setDraft}
        allowWatchOnlyCategory={false}
        disabled={pending}
      />
      <PassphraseField
        id={`register-key-passphrase-${props.record.address}`}
        label="Passphrase"
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="current-password"
        help="The key signs the ownership challenge; it is decrypted only for that signature."
        disabled={pending}
      />
      {failure ? <ErrorState title={failure.title} requestId={failure.requestId} /> : null}
      <Button
        type="submit"
        variant="primary"
        disabled={pending || draft.label.trim() === "" || passphrase === ""}
      >
        {pending ? "Registering the wallet…" : "Register this key"}
      </Button>
    </form>
  );
}

/** LWG-AC-08 — keys stored in this browser that are not in the organization registry. */
export function UnregisteredKeysPanel(props: { canRegister: boolean }) {
  const router = useRouter();
  const keys = useLocalKeys();
  const records = keys.data ?? [];
  const statuses = useRegistrationStatus(records);
  const [open, setOpen] = useState<string | null>(null);
  const unregistered = records.filter((_, index) => statuses[index]?.data === false);
  if (unregistered.length === 0) return null;

  return (
    <Panel title="Keys on this device not registered">
      <p className="mb-2 text-[12px] text-text-secondary">
        These keys are stored encrypted in this browser but are not in your organization&apos;s registry.
      </p>
      <ul className="space-y-2 text-[12px]">
        {unregistered.map((record) => (
          <li key={record.address} className="border-b border-border/60 pb-2 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <AddressText value={record.address} label="Unregistered key" />
              <span className="text-text-muted">
                generated <Timestamp value={record.createdAt} />
              </span>
              {props.canRegister && open !== record.address ? (
                <Button onClick={() => setOpen(record.address)}>Register</Button>
              ) : null}
            </div>
            {open === record.address ? (
              <RegisterKeyForm record={record} onDone={(walletId) => router.push(`/wallets/${walletId}`)} />
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
