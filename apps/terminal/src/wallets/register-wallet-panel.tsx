"use client";

import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { AddressText, Button, ErrorState, FormField, Panel, TextInput } from "@sct/ui";
import { isAddress } from "@solana/kit";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { useSession } from "../auth/use-session";
import { ApiRequestError } from "../platform/api-client";
import { proveWalletControl, useRegisterWallet } from "./registry-api";
import { TERMINAL_WALLET_CHAIN, useIsHydrated, useWalletClient } from "./wallet-client";
import {
  EMPTY_METADATA,
  metadataRequest,
  WalletMetadataFields,
  type WalletMetadataDraft,
} from "./wallet-metadata-fields";

export type RegistrationMode = "connected" | "watch-only";

function describeError(error: unknown): { title: string; requestId?: string | undefined } | null {
  if (!error) return null;
  if (error instanceof ApiRequestError) {
    return {
      title:
        error.code === "WALLET_ALREADY_REGISTERED"
          ? "This address is already registered in this organization. If it was archived, restore it from its page."
          : error.message,
      requestId: error.requestId,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") return null;
  if (error instanceof Error) return { title: error.message };
  return { title: "The wallet request failed." };
}

function RegistrationForm(props: {
  idPrefix: string;
  allowWatchOnlyCategory: boolean;
  initial: WalletMetadataDraft;
  addressField?: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  disabled?: boolean;
  error: unknown;
  onSubmit: (draft: WalletMetadataDraft) => void;
}) {
  const [draft, setDraft] = useState(props.initial);
  const failure = describeError(props.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit(draft);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {props.addressField}
      <WalletMetadataFields
        idPrefix={props.idPrefix}
        draft={draft}
        onChange={setDraft}
        allowWatchOnlyCategory={props.allowWatchOnlyCategory}
        disabled={props.pending}
      />
      {failure ? <ErrorState title={failure.title} requestId={failure.requestId} /> : null}
      <Button
        type="submit"
        variant="primary"
        disabled={props.pending || props.disabled || draft.label.trim() === ""}
      >
        {props.pending ? props.pendingLabel : props.submitLabel}
      </Button>
    </form>
  );
}

/** WRG-AC-02 — registers the connected Wallet Standard account after it signs an ownership challenge. */
function RegisterConnectedWallet(props: { onRegistered: (walletId: string) => void }) {
  const client = useWalletClient();
  const hydrated = useIsHydrated();
  const connected = useConnectedWallet(client);
  const { session } = useSession();
  const register = useRegisterWallet();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!hydrated || !connected) {
    return (
      <p className="text-[12px] text-text-secondary">Connect a wallet from the status bar to register it.</p>
    );
  }
  if (!connected.account.chains.includes(TERMINAL_WALLET_CHAIN)) {
    return (
      <ErrorState title="This wallet account is not configured for Solana Devnet.">
        Switch the wallet network to Devnet to register it.
      </ErrorState>
    );
  }
  const canSign = connected.wallet.features.includes("solana:signMessage");
  const address = connected.account.address;

  const submit = async (draft: WalletMetadataDraft) => {
    setError(null);
    setSigning(true);
    try {
      const ownership = await proveWalletControl(
        address,
        async (message) => new Uint8Array(await client.wallet.signMessage(message)),
        session?.csrfToken,
      );
      setSigning(false);
      const wallet = await register.mutateAsync({
        custodyType: "BROWSER_WALLET",
        address,
        ...metadataRequest(draft),
        ownership,
      });
      props.onRegistered(wallet.id);
    } catch (caught) {
      setError(caught);
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-text-secondary">{connected.wallet.name}</span>
        <AddressText value={address} label="Connected wallet" />
      </div>
      <p className="text-[12px] text-text-secondary">
        The wallet signs a text message proving you control this account. It does not create a transaction or
        cost any fees.
      </p>
      {!canSign ? (
        <ErrorState title="This wallet cannot sign messages, so control of the account cannot be proven." />
      ) : null}
      <RegistrationForm
        idPrefix="register-connected"
        allowWatchOnlyCategory={false}
        initial={{ ...EMPTY_METADATA, label: connected.wallet.name.slice(0, 64) }}
        submitLabel="Sign and register"
        pendingLabel={signing ? "Waiting for wallet signature…" : "Registering the wallet…"}
        pending={signing || register.isPending}
        disabled={!canSign}
        error={error}
        onSubmit={(draft) => void submit(draft)}
      />
    </div>
  );
}

/** WRG-AC-01 — registers any valid address without claiming control. */
function RegisterWatchOnly(props: { onRegistered: (walletId: string) => void }) {
  const register = useRegisterWallet();
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);

  const submit = async (draft: WalletMetadataDraft) => {
    const trimmed = address.trim();
    if (!isAddress(trimmed)) {
      setAddressError("Enter a valid base58 Solana address.");
      return;
    }
    setAddressError(null);
    try {
      const wallet = await register.mutateAsync({
        custodyType: "WATCH_ONLY",
        address: trimmed,
        ...metadataRequest(draft),
      });
      props.onRegistered(wallet.id);
    } catch {
      // Rendered from register.error.
    }
  };

  return (
    <RegistrationForm
      idPrefix="register-watch"
      allowWatchOnlyCategory
      initial={{ ...EMPTY_METADATA, category: "WATCH_ONLY" }}
      submitLabel="Add watch-only address"
      pendingLabel="Registering the wallet…"
      pending={register.isPending}
      error={register.error}
      onSubmit={(draft) => void submit(draft)}
      addressField={
        <FormField
          id="register-watch-address"
          label="Address"
          help="Watch-only wallets are read-only: nothing can be signed."
        >
          <TextInput
            id="register-watch-address"
            value={address}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            aria-invalid={addressError !== null}
            aria-describedby={addressError ? "register-watch-address-error" : "register-watch-address-help"}
            onChange={(event) => setAddress(event.target.value)}
          />
          {addressError ? (
            <p id="register-watch-address-error" className="text-[11px] text-negative">
              {addressError}
            </p>
          ) : null}
        </FormField>
      }
    />
  );
}

const MODE_TITLES: Record<RegistrationMode, string> = {
  connected: "Register connected wallet",
  "watch-only": "Add watch-only address",
};

export function RegisterWalletPanel(props: { mode: RegistrationMode; onClose: () => void }) {
  const router = useRouter();
  const onRegistered = (walletId: string) => router.push(`/wallets/${walletId}`);
  return (
    <Panel
      title={MODE_TITLES[props.mode]}
      actions={
        <Button variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      {props.mode === "connected" ? (
        <RegisterConnectedWallet onRegistered={onRegistered} />
      ) : (
        <RegisterWatchOnly onRegistered={onRegistered} />
      )}
    </Panel>
  );
}
