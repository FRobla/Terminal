import type { ClientWithWallet } from "@solana/kit-plugin-wallet";
import { siwsChallengeResponseSchema } from "@sct/validation";
import type { UiWallet } from "@wallet-standard/ui";
import { z } from "zod";
import { apiRequest } from "../platform/api-client";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Sign-In With Solana (SPEC-007 §3): uses the wallet's `solana:signIn` feature when
 * available, otherwise signs the identical server-built message with `solana:signMessage`.
 * The wallet only signs a text message; no transaction is created.
 */
export async function signInWithWallet(
  client: ClientWithWallet,
  wallet: UiWallet,
  address: string,
): Promise<void> {
  const challenge = await apiRequest("/auth/siws/challenge", siwsChallengeResponseSchema, {
    method: "POST",
    body: { address },
  });

  let signedMessage: Uint8Array;
  let signature: Uint8Array;
  let method: "signIn" | "signMessage";

  if (wallet.features.includes("solana:signIn")) {
    const output = await client.wallet.signIn(wallet, { ...challenge.input });
    if (output.account.address !== address) {
      throw new Error("The wallet signed in with a different account than the one selected.");
    }
    signedMessage = new Uint8Array(output.signedMessage);
    signature = new Uint8Array(output.signature);
    method = "signIn";
  } else if (wallet.features.includes("solana:signMessage")) {
    signedMessage = new TextEncoder().encode(challenge.message);
    signature = new Uint8Array(await client.wallet.signMessage(signedMessage));
    method = "signMessage";
  } else {
    throw new Error("This wallet supports neither Sign-In With Solana nor message signing.");
  }

  await apiRequest("/auth/siws/verify", z.object({ expiresAt: z.string() }), {
    method: "POST",
    body: {
      challengeId: challenge.challengeId,
      address,
      signedMessage: toBase64(signedMessage),
      signature: toBase64(signature),
      method,
    },
  });
}
