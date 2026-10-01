"use client";

import { Button, ErrorState, FormField, LoadingState, Panel, TextInput } from "@sct/ui";
import { walletExportResponseSchema, type ManagedWallet } from "@sct/validation";
import { useState } from "react";
import { useSession } from "../auth/use-session";
import { ApiRequestError, apiRequest } from "../platform/api-client";
import { PassphraseField } from "./create-local-wallet-panel";
import { WrongPassphraseError } from "./key-encryption";
import { recoveryFileContent } from "./local-key-vault";
import { useDeleteLocalKey, useLocalKeys } from "./use-local-keys";

function describe(error: unknown) {
  if (error instanceof ApiRequestError) return { title: error.message, requestId: error.requestId };
  if (error instanceof WrongPassphraseError || error instanceof Error)
    return { title: error.message, requestId: undefined };
  return null;
}

/** Hands a file to the browser without keeping its content in component state. */
function download(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileNameFor(wallet: ManagedWallet): string {
  const safeLabel =
    wallet.label
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "wallet";
  return `${safeLabel}-${wallet.address.slice(0, 4)}${wallet.address.slice(-4)}-devnet.json`;
}

/** LWG-AC-07 — explicit export with warnings, passphrase, typed label, and a prior API audit. */
function ExportForm(props: { wallet: ManagedWallet; onDone: () => void; onCancel: () => void }) {
  const { session } = useSession();
  const keys = useLocalKeys();
  const [passphrase, setPassphrase] = useState("");
  const [typedLabel, setTypedLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const record = keys.data?.find((entry) => entry.address === props.wallet.address);
  const failure = describe(error);

  const submit = async () => {
    if (!record) return;
    setPending(true);
    setError(null);
    try {
      // The API authorizes and audits before anything is decrypted.
      await apiRequest(
        `/wallets/${encodeURIComponent(props.wallet.id)}/exports`,
        walletExportResponseSchema,
        {
          method: "POST",
          csrfToken: session?.csrfToken,
        },
      );
      download(fileNameFor(props.wallet), await recoveryFileContent(record, passphrase));
      setPassphrase("");
      props.onDone();
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ul className="list-disc space-y-1 pl-5 text-[12px] text-warning">
        <li>Anyone with this file controls the wallet and its funds.</li>
        <li>The terminal cannot recover it or revoke it once it is copied.</li>
        <li>Store it offline. It is never shown on screen, copied, or sent anywhere by the terminal.</li>
      </ul>
      <PassphraseField
        id="export-passphrase"
        label="Passphrase"
        value={passphrase}
        onChange={setPassphrase}
        autoComplete="current-password"
        disabled={pending}
      />
      <FormField id="export-confirm-label" label={`Type "${props.wallet.label}" to confirm`}>
        <TextInput
          id="export-confirm-label"
          value={typedLabel}
          autoComplete="off"
          disabled={pending}
          onChange={(event) => setTypedLabel(event.target.value)}
        />
      </FormField>
      {failure ? <ErrorState title={failure.title} requestId={failure.requestId} /> : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          disabled={pending || passphrase === "" || typedLabel !== props.wallet.label}
        >
          {pending ? "Preparing the recovery file…" : "Download recovery file"}
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** LWG-AC-09 — removes the encrypted key from this browser only. */
function RemoveForm(props: { wallet: ManagedWallet; onDone: () => void; onCancel: () => void }) {
  const remove = useDeleteLocalKey();
  const [typedLabel, setTypedLabel] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        remove.mutate(props.wallet.address, { onSuccess: props.onDone });
      }}
    >
      <p className="text-[12px] text-warning">
        The registry entry stays. Without an exported recovery file, the key and its funds become
        unrecoverable.
      </p>
      <label className="flex items-center gap-2 text-[12px]">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I exported the recovery file or accept losing this wallet.
      </label>
      <FormField id="remove-confirm-label" label={`Type "${props.wallet.label}" to confirm`}>
        <TextInput
          id="remove-confirm-label"
          value={typedLabel}
          autoComplete="off"
          onChange={(event) => setTypedLabel(event.target.value)}
        />
      </FormField>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          disabled={remove.isPending || !acknowledged || typedLabel !== props.wallet.label}
        >
          Remove key from this device
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** SPEC-010 §4.2, §4.4, §4.5 — presence, export, and removal for a LOCAL_ENCRYPTED wallet. */
export function LocalKeyPanel(props: { wallet: ManagedWallet; justCreated: boolean }) {
  const { can } = useSession();
  const keys = useLocalKeys();
  const [mode, setMode] = useState<"idle" | "export" | "remove">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const present = keys.data?.some((record) => record.address === props.wallet.address) ?? false;

  return (
    <Panel title="Local key">
      {keys.isPending ? (
        <LoadingState operation="Checking this browser's key store…" rows={1} />
      ) : (
        <div className="space-y-2 text-[12px]">
          <p className={present ? "text-positive" : "text-text-secondary"}>
            {present ? "Key on this device" : "Key not on this device"}
          </p>
          {!present ? (
            <p className="text-text-muted">
              This wallet was generated in another browser. Signing and export are available only where its
              key is stored.
            </p>
          ) : null}
          {props.justCreated && present ? (
            <p role="status" className="text-warning">
              Wallet created. Export the recovery file now and store it offline.
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-text-secondary">
              {notice}
            </p>
          ) : null}
          {present && mode === "idle" ? (
            <div className="flex flex-wrap gap-2">
              {can("wallet.export") ? (
                <Button onClick={() => setMode("export")}>Export recovery material</Button>
              ) : null}
              <Button variant="danger" onClick={() => setMode("remove")}>
                Remove from this device
              </Button>
            </div>
          ) : null}
          {mode === "export" ? (
            <ExportForm
              wallet={props.wallet}
              onCancel={() => setMode("idle")}
              onDone={() => {
                setMode("idle");
                setNotice("Recovery file downloaded. Store it offline.");
              }}
            />
          ) : null}
          {mode === "remove" ? (
            <RemoveForm
              wallet={props.wallet}
              onCancel={() => setMode("idle")}
              onDone={() => {
                setMode("idle");
                setNotice("The key was removed from this browser.");
              }}
            />
          ) : null}
        </div>
      )}
    </Panel>
  );
}
