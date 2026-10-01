import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit";
import type { ClientWithWallet } from "@solana/kit-plugin-wallet";
import type { LocalKeyRecord } from "../local-wallets/local-key-record";
import { signWireTransactionWith, withLocalSigner } from "../local-wallets/local-key-vault";

/**
 * The signing boundary (ADR-0004 §3, SPEC-010 LWG-AC-05): every path takes the exact wire
 * transaction prepared and reviewed by the API and returns it signed. Nothing else is signed.
 */

export class SigningUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningUnavailableError";
  }
}

const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Wallet Standard `solana:signTransaction` through the connected account's signer. */
export async function signWithConnectedWallet(
  client: ClientWithWallet,
  expectedAddress: string,
  unsignedBase64: string,
): Promise<string> {
  const connected = client.wallet.getState().connected;
  if (!connected || connected.account.address !== expectedAddress) {
    throw new SigningUnavailableError("Connect the wallet that holds this account to sign.");
  }
  if (!connected.signer || !connected.supportedTransactionVersions.has(0)) {
    throw new SigningUnavailableError("This wallet cannot sign version-0 transactions.");
  }
  const transaction = getTransactionDecoder().decode(base64ToBytes(unsignedBase64));
  const signer = connected.signer;
  let signed: typeof transaction;
  if ("modifyAndSignTransactions" in signer) {
    const [result] = await signer.modifyAndSignTransactions([transaction as never]);
    if (!result) throw new Error("The wallet returned no transaction.");
    signed = result;
  } else if ("signTransactions" in signer) {
    const [signatures] = await signer.signTransactions([transaction as never]);
    const signature = signatures?.[signer.address];
    if (!signature) throw new Error("The wallet returned no signature.");
    signed = { ...transaction, signatures: { ...transaction.signatures, [signer.address]: signature } };
  } else {
    // Sign-and-send wallets would broadcast without the API's checks; they are not used.
    throw new SigningUnavailableError(
      "This wallet can only sign and send in one step, which the terminal does not allow.",
    );
  }
  // The API compares the signed message with the reviewed one; a modified message is refused.
  return bytesToBase64(new Uint8Array(getTransactionEncoder().encode(signed)));
}

/** A local encrypted key, decrypted only for this one signature. */
export async function signWithLocalKey(
  record: LocalKeyRecord,
  passphrase: string,
  unsignedBase64: string,
): Promise<string> {
  const signed = await withLocalSigner(record, passphrase, (signer) =>
    signWireTransactionWith(signer, base64ToBytes(unsignedBase64)),
  );
  return bytesToBase64(signed);
}
