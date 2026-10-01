# SPEC-010 — Local Wallet Generation

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 02 |
| Domain(s) | terminal `local-wallets`, `signing`; api `wallets` (registration, export audit) |
| Criteria prefix | `LWG` |
| Related | ADR-0004, SECURITY.md §2–3, SPEC-009, SPEC-004, prompt §27–28 |

## 1. Problem and goal

Operators need Devnet wallets for testing treasury, trading, and token-issuance flows without installing a browser extension per wallet. The terminal generates such wallets in the browser, keeps the private key encrypted on the user's device, and registers only the public address in the organization registry.

This is a convenience for Devnet operations, **not institutional custody**. The terminal states this plainly: the key lives in this browser on this device, the server cannot recover it, and losing the passphrase or the browser storage loses the wallet. Custody backends (KMS, HSM, MPC, multisig) remain a future path behind the same signing boundary (ADR-0004 §3).

## 2. Scope

In scope:
- Key generation in the browser with Web Crypto Ed25519 through `@solana/kit`.
- Encryption at rest in IndexedDB with a passphrase-derived key.
- Registration of the public address in the registry (SPEC-009, custody `LOCAL_ENCRYPTED`) with proof of control.
- Signing through a `TransactionSigner`-compatible boundary: the decrypted key exists only for one signing operation.
- Explicit export of recovery material with warnings, permission check, and audit.
- Removing the key from this device.

Out of scope:
- Importing existing keys or seed phrases (not required; increases phishing surface).
- Mnemonic (BIP-39) generation and HD derivation.
- Syncing keys between devices or backing them up to the server (forbidden by ADR-0004).
- Changing the passphrase (a later iteration; a user can export and generate a new wallet instead).

## 3. Domain concepts

- **LocalKeyRecord** (IndexedDB database `sct-local-wallets`, version 1, object store `keys`, key path `address`):

| Field | Value |
| --- | --- |
| `version` | `1` |
| `address` | base58 public key |
| `cluster` | cluster at generation (`devnet`) |
| `kdf` | `{ name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: <16 random bytes> }` |
| `cipher` | `{ name: "AES-GCM", iv: <12 random bytes> }` |
| `ciphertext` | AES-256-GCM encryption of the 32-byte Ed25519 private key seed, with the address as additional authenticated data |
| `createdAt` | ISO timestamp |

- **Passphrase:** 12–256 characters, entered twice at creation; never stored, logged, or transmitted. The UI rates nothing and promises nothing beyond the minimum length.
- **Unlock:** decrypting the seed with the passphrase. A wrong passphrase fails AES-GCM authentication and is reported as "The passphrase is incorrect." (no detail about why).
- **Signing boundary:** a `TransactionPartialSigner` from `@solana/kit` created from the decrypted seed as a **non-extractable** `CryptoKeyPair`, used for one signing operation, then dropped. The same boundary wraps Wallet Standard `solana:signTransaction` for browser wallets (SPEC-004 amendment).
- **Recovery material:** the 64-byte secret key (`seed ‖ public key`) as a JSON byte array (Solana CLI keypair file format), offered as a file download only.

## 4. Behavior

1. **Create.** In **Wallets → Create local wallet**, a signed-in user with `wallet.create`:
   1. reads the custody notice ("This wallet's key is stored encrypted in this browser only…") and acknowledges it;
   2. enters label, category (not `WATCH_ONLY`), optional purpose and tags, and a passphrase twice;
   3. the terminal draws a 32-byte Ed25519 seed from the browser CSPRNG (`crypto.getRandomValues`), imports it into Web Crypto as a non-extractable key pair to derive the address, derives the AES key (PBKDF2-SHA-256, 600,000 iterations, random salt), encrypts the seed (random IV, address as AAD), writes the record (an existing record for the address is never overwritten), and overwrites the seed buffer;
   4. the terminal re-imports the seed as a non-extractable signer, requests an ownership challenge, signs it, and registers the wallet as `LOCAL_ENCRYPTED` (SPEC-009 WRG-AC-02);
   5. the result screen shows the address, `SOLANA DEVNET`, a copy action, a Devnet explorer link, and a recommendation to export recovery material now.
   If registration fails, the key record stays on the device and the wallet is listed under **Keys on this device not registered** with a Register action, so a generated key is never silently lost.
2. **Presence.** For each registered `LOCAL_ENCRYPTED` wallet, the terminal checks IndexedDB: present → "Key on this device"; absent → "Key not on this device" (signing and export unavailable here).
3. **Sign.** When a flow needs the wallet's signature (SPEC-004), the terminal asks for the passphrase in a dialog that names the wallet and the operation, decrypts, signs the exact transaction bytes reviewed, and discards the key and passphrase.
4. **Export.** **Export recovery material** (requires `wallet.export`):
   1. shows the warnings: anyone with the file controls the wallet; the terminal cannot recover it; store it offline;
   2. requires the passphrase and typing the wallet label;
   3. calls `POST /wallets/{id}/exports` — the API checks `wallet.export`, the organization, custody `LOCAL_ENCRYPTED`, and audits `wallet.exported` (address only);
   4. only after a successful response, decrypts and offers `<label>-<short address>-devnet.json` for download, then clears the bytes. The material is never shown on screen, copied to the clipboard by the terminal, or sent anywhere.
5. **Remove from this device.** Requires typing the wallet label and acknowledging that the key will be unrecoverable without an export. Deletes the IndexedDB record only; the registry entry is unchanged (it can be archived separately). Not audited server-side (no server state changes); recorded in the terminal as a confirmation message.

## 5. External data dependencies

None beyond SPEC-009 registration. All cryptography runs in the browser (Web Crypto). Browsers without Web Crypto Ed25519 support show "This browser cannot generate Ed25519 keys with Web Crypto. Use a current version of Chrome, Edge, Firefox, or Safari." and the create action is unavailable.

## 6. Security considerations

- **Never sent:** private key, seed, passphrase, ciphertext, salt, or IV. A test intercepts every terminal request during the create, sign, and export flows and asserts that none contains key material.
- **Never logged or persisted in plaintext:** no `console` output of key material; no `localStorage`; React state holds no key bytes; buffers are overwritten after use.
- **Extractability:** no Web Crypto key is ever extractable. The raw seed exists only briefly in memory during generation (to encrypt it) and export (decrypt → file), and the buffer is overwritten afterwards. Signing uses a non-extractable key.
- **Brute force:** offline guessing of a stolen ciphertext is slowed by PBKDF2 at 600,000 iterations (OWASP 2023 guidance for PBKDF2-HMAC-SHA256); a long passphrase is the real defense, stated in the UI.
- **Export authorization:** `wallet.export` is enforced by the API before the terminal decrypts. Because the ciphertext is on the user's device, this is an audit and policy gate, not a cryptographic one; the documentation says so.
- **Signing policy:** every signature follows SECURITY.md §3 (server-built review, explicit confirmation, no auto-sign, no remembered approval).
- **XSS:** the existing nonce-based CSP applies; key operations live in a dedicated module without third-party scripts.

## 7. States

| State | Trigger | UI representation |
| --- | --- | --- |
| Unsupported | No Web Crypto Ed25519 | Unsupported notice; create unavailable |
| Generating | Key generation and encryption in progress | "Generating and encrypting the key…" |
| Registering | Ownership proof and registration | "Registering the wallet…" |
| Created | Success | Address, network, export recommendation |
| Registration failed | API error after the key was stored | Error with request id; key kept under **Keys on this device not registered** |
| Key absent | Registered wallet, no record on this device | "Key not on this device" |
| Wrong passphrase | AES-GCM authentication failed | "The passphrase is incorrect." |
| Exporting | Permission check and decryption | "Preparing the recovery file…" |

## 8. Acceptance criteria

### LWG-AC-01 — Generation and encryption
Given a signed-in user with `wallet.create` in a browser with Web Crypto Ed25519
When they create a local wallet with a valid passphrase
Then an Ed25519 key pair is generated in the browser, a version-1 record with PBKDF2-SHA-256 (600,000 iterations, 16-byte salt) and AES-256-GCM (12-byte IV, address as AAD) is stored in IndexedDB, and the record contains no plaintext key material.

### LWG-AC-02 — Registration with public data only
Given a newly generated local wallet
When the terminal registers it
Then the wallet appears in the registry as `LOCAL_ENCRYPTED` with proof of control (SPEC-009 WRG-AC-02), `wallet.created` is audited, and no request made during the flow contains the private key, seed, passphrase, ciphertext, salt, or IV.

### LWG-AC-03 — Round trip and wrong passphrase
Given a stored record
When it is decrypted with the correct passphrase
Then the derived public key equals the record's address; and with a wrong passphrase, decryption fails with "The passphrase is incorrect." and no key is produced.

### LWG-AC-04 — Passphrase policy
Given the create form
When the passphrase is shorter than 12 characters, longer than 256, or the confirmation differs
Then creation is refused with a specific message and no key is generated.

### LWG-AC-05 — Signing boundary
Given a registered local wallet with its key on this device
When a flow requests its signature and the user enters the passphrase
Then the exact reviewed transaction bytes are signed by a non-extractable key that is discarded after the operation, and the signature verifies against the wallet address.

### LWG-AC-06 — Key presence
Given registered `LOCAL_ENCRYPTED` wallets
When the registry renders on a device with and without their records
Then each shows "Key on this device" or "Key not on this device", and signing and export are offered only where the key is present.

### LWG-AC-07 — Export
Given a user with `wallet.export`, the correct passphrase, and the typed wallet label
When they export recovery material
Then the API audits `wallet.exported` before any decryption, the terminal downloads a Solana CLI–format 64-byte key file whose public half equals the address, and nothing is displayed, copied, or transmitted; without `wallet.export` the API returns `403 FORBIDDEN` and no file is produced.

### LWG-AC-08 — Registration failure keeps the key
Given registration fails after the key was stored
When the user returns to **Wallets**
Then the key is listed under **Keys on this device not registered** with a Register action that completes registration without generating a new key.

### LWG-AC-09 — Remove from device
Given a local key on this device
When the user confirms removal by typing the wallet label
Then the IndexedDB record is deleted, the registry entry is unchanged, and the wallet shows "Key not on this device".

### LWG-AC-10 — Unsupported browsers
Given a browser without Web Crypto Ed25519
When the user opens **Create local wallet**
Then the unsupported notice is shown and generation cannot start.

## 9. Test plan

| Criterion | Test layer | Notes |
| --- | --- | --- |
| LWG-AC-01, 03, 04, 05 | Unit (Vitest, Node Web Crypto) | Record shape, round trip, wrong passphrase, authenticated address, signature verification |
| LWG-AC-02, 06, 08, 09 | E2E (Chromium, real API, real IndexedDB) | Request recording asserts no passphrase, ciphertext, salt, IV, or secret key leaves the browser |
| LWG-AC-07 | API integration (permission, audit) + E2E (download content) | |
| LWG-AC-10 | Unit (capability detection) | |

## 10. Open questions

- Passphrase change and re-encryption (later iteration).
- Whether to require a recent re-authentication (fresh SIWS) before export, in addition to the passphrase. Not required by ADR-0004; revisit with Iteration 08 policies.

## Amendments

### 2026-10-01 — Generation method clarified during implementation

Reason: `@solana/kit` creates a non-extractable key pair from 32 seed bytes, so the seed is drawn from the browser CSPRNG and imported, instead of generating an extractable Web Crypto key and exporting it. The result is the same Ed25519 key, and no Web Crypto key is ever extractable. §4.1 step 3 and §6 (extractability) were updated; no acceptance criterion changed. IndexedDB behavior is verified end to end in a real browser instead of with an in-memory IndexedDB in unit tests.
