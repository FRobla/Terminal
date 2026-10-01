/**
 * Test-only Wallet Standard wallet (TESTING.md §7). Injected by Playwright with
 * `page.addInitScript(installTestWallet, options)`, so this function must be fully
 * self-contained: no imports, no closures over module scope. It is never bundled
 * into the terminal (verified by the production bundle check).
 */
export interface TestWalletOptions {
  name: string;
  /** Chains the wallet advertises (discovery filter). */
  walletChains: string[];
  /** Chains the connected account supports (cluster check). Defaults to walletChains. */
  accountChains?: string[];
  supportSignIn: boolean;
}

export const TEST_WALLET_MARKER = "__SCT_TEST_WALLET__";

export function installTestWallet(options: TestWalletOptions): void {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const base58 = (bytes: Uint8Array): string => {
    let value = 0n;
    for (const byte of bytes) value = value * 256n + BigInt(byte);
    let output = "";
    while (value > 0n) {
      output = ALPHABET[Number(value % 58n)] + output;
      value /= 58n;
    }
    for (const byte of bytes) {
      if (byte !== 0) break;
      output = `1${output}`;
    }
    return output;
  };

  const keyPairPromise = crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;
  const accountPromise = keyPairPromise.then(async (keyPair) => {
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    return {
      address: base58(publicKey),
      publicKey,
      chains: options.accountChains ?? options.walletChains,
      features: ["solana:signMessage", ...(options.supportSignIn ? ["solana:signIn"] : [])],
    };
  });
  const sign = async (message: Uint8Array<ArrayBuffer>) => {
    const keyPair = await keyPairPromise;
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, message));
  };

  type Account = Awaited<typeof accountPromise>;
  let connected: Account | null = null;
  const listeners = new Set<(properties: { accounts: Account[] }) => void>();
  const emit = () => listeners.forEach((listener) => listener({ accounts: connected ? [connected] : [] }));

  const signInText = (input: Record<string, string | undefined>, address: string) => {
    let message = `${input.domain} wants you to sign in with your Solana account:\n${address}`;
    if (input.statement) message += `\n\n${input.statement}`;
    const fields: string[] = [];
    if (input.uri) fields.push(`URI: ${input.uri}`);
    if (input.version) fields.push(`Version: ${input.version}`);
    if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
    if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
    if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
    if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
    if (fields.length > 0) message += `\n\n${fields.join("\n")}`;
    return message;
  };

  const icon = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#777"/></svg>',
  )}`;

  const features: Record<string, unknown> = {
    "standard:connect": {
      version: "1.0.0",
      connect: async () => {
        connected = await accountPromise;
        emit();
        return { accounts: [connected] };
      },
    },
    "standard:disconnect": {
      version: "1.0.0",
      disconnect: async () => {
        connected = null;
        emit();
      },
    },
    "standard:events": {
      version: "1.0.0",
      on: (_event: string, listener: (properties: { accounts: Account[] }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    "solana:signMessage": {
      version: "1.0.0",
      signMessage: async (...inputs: Array<{ message: Uint8Array<ArrayBuffer> }>) =>
        Promise.all(
          inputs.map(async ({ message }) => ({ signedMessage: message, signature: await sign(message) })),
        ),
    },
  };
  if (options.supportSignIn) {
    features["solana:signIn"] = {
      version: "1.0.0",
      signIn: async (...inputs: Array<Record<string, string | undefined>>) => {
        connected = await accountPromise;
        emit();
        const account = connected;
        return Promise.all(
          inputs.map(async (input) => {
            const signedMessage = new TextEncoder().encode(signInText(input, account.address));
            return { account, signedMessage, signature: await sign(signedMessage), signatureType: "ed25519" };
          }),
        );
      },
    };
  }

  const wallet = {
    version: "1.0.0",
    name: options.name,
    icon,
    chains: options.walletChains,
    features,
    get accounts() {
      return connected ? [connected] : [];
    },
  };

  const register = ({ register: registerWallet }: { register: (wallet: unknown) => void }) =>
    registerWallet(wallet);
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent).detail));
  // Literal (not TEST_WALLET_MARKER): this function is serialized into the page.
  (window as unknown as Record<string, unknown>)["__SCT_TEST_WALLET__"] = {
    address: () => accountPromise.then((account) => account.address),
  };
}
