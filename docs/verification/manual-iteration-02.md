# Manual Verification — Iteration 02 (Wallet Subsystem)

Owner-run browser verification that closes Iteration 02. Automated tests cover every acceptance criterion. This guide checks the parts that need a real third-party wallet, real Devnet funds, and the running worker: signing, confirmation, and reconciliation.

Mark each item `[x]` when it passes. When an item fails, write what you saw under it (screen, message, request id) and leave it unchecked.

---

## 0. Preparation

- [ ] Iterations 01 and 01.5 setup from [manual-iterations-01.md](./manual-iterations-01.md) §0 works: `.env`, Docker running, `pnpm infra:up`.
- [ ] `pnpm db:migrate` applies `0004_wallet_registry` and `0005_transaction_lifecycle`.
- [ ] `pnpm dev` runs the terminal, the API, **and the worker**. Confirmation and reconciliation need the worker.
- [ ] **Wallet A (owner)**: a browser wallet on Devnet with some Devnet SOL. If the RPC faucet is exhausted, use https://faucet.solana.com (sign in with GitHub for higher limits).
- [ ] **Wallet B (admin)**, optional: a second account for the assignment checks (OWN setup from the 01 guide).
- [ ] Owner console → Jobs lists `wallets.sync`, `transactions.confirmation`, and `transactions.reconciliation`, each with a scheduler.

---

## 1. Wallet registry (SPEC-009)

### WRG-AC-05 — Signing in does not register
- [ ] Sign in with Wallet A and open **Wallets**. Wallet A is not listed until you register it.

### WRG-AC-02 — Register the connected wallet
- [ ] **Register connected wallet** → label "Treasury hot", category Treasury, tags `ops, devnet` → **Sign and register**.
- [ ] The wallet asks you to sign a **text message** that names the account, `devnet`, the organization, and says no transaction is authorized. Approve it.
- [ ] You land on the wallet page. Category, custody (Browser wallet), tags, and **Creator** assignment are shown.
- [ ] The SOL balance matches Solana Explorer.

### WRG-AC-03 — Proof of control is enforced
- [ ] Start **Register connected wallet** again and reject the signature in the wallet. No wallet is created, and the error is shown.

### WRG-AC-01 / WRG-AC-04 — Watch-only and validation
- [ ] **Add watch-only address** with an invalid address: "Enter a valid base58 Solana address."
- [ ] Add a real Devnet address (e.g. a friend's wallet) as watch-only. It is listed with custody Watch-only.
- [ ] Adding the same address again shows that it is already registered.

### WRG-AC-06 / WRG-AC-15 — List with balances
- [ ] The list shows label, short address, category, custody, tags, SOL balance, and history status.
- [ ] The data source control on the panel shows `getMultipleAccounts`, `devnet`, `confirmed`, and a slot. The freshness label updates.
- [ ] The Status, Category, Custody, Tag, and Search filters each narrow the list. "No wallets match these filters." appears when nothing matches.

### WRG-AC-08 — Edit and archive
- [ ] **Edit** the watch-only wallet: change the label and notes (multi-line) → **Save changes**.
- [ ] **Archive wallet** → confirm. It disappears from the default list and appears under the Archived status filter. **Restore wallet** brings it back.

### WRG-AC-09 — Assignments (needs Wallet B as a member)
- [ ] On "Treasury hot", assign Wallet B's user as **Controller**. Remove it again. The owner audit log shows `wallet.assigned` and `wallet.unassigned`.

### WRG-AC-11..14 — Indexed history
- [ ] Within about a minute of registration, **Indexed history** lists Wallet A's recent transactions. Rows show block time, status, SOL change, and fee, filled in over a few minutes.
- [ ] **Sync now** says synchronization was requested. Pressing it again within 30 s says to try again in N s.
- [ ] The footer shows "Indexed since …" and the last sync time.

---

## 2. Local wallets (SPEC-010)

### LWG-AC-01 / 02 / 04 — Create
- [ ] **Create local wallet**: the custody notice explains that the key lives only in this browser and is not institutional custody.
- [ ] A passphrase shorter than 12 characters is refused ("Use at least 12 characters.").
- [ ] With a valid passphrase, label "Local dev", and the notice acknowledged → **Create and register**. You land on the wallet page with "Key on this device" and the export recommendation.
- [ ] DevTools → Application → IndexedDB → `sct-local-wallets` → `keys` holds one record with `kdf`, `cipher`, and `ciphertext`, and no readable key.

### LWG-AC-07 — Export
- [ ] **Export recovery material** → enter the passphrase and type the label → **Download recovery file**. A `.json` file with 64 numbers downloads. Store it offline, or delete it after the check.
- [ ] A wrong passphrase shows "The passphrase is incorrect." and downloads nothing.
- [ ] The owner audit log shows `wallet.exported` (address only).

### LWG-AC-06 — Presence on another device
- [ ] Open the terminal in another browser profile and sign in with Wallet A. The local wallet shows "Key not on this device", and export is not offered.

### LWG-AC-09 — Remove from this device
- [ ] Optional, after exporting: **Remove from this device** → confirm. The wallet stays in the registry and shows "Key not on this device".

---

## 3. SOL transfers (SPEC-004)

Use "Treasury hot" (Wallet A, funded) as the source and "Local dev" as the destination (copy its address).

### TXL-AC-03 — Review
- [ ] On "Treasury hot", **Transfer SOL** → paste the destination, amount `0.01` → **Review transfer**.
- [ ] The transaction page shows Network `SOLANA DEVNET`, fee payer and signer (Wallet A), Programs: System Program, the writable accounts, the balance changes (source −0.01 SOL minus the fee, destination +0.01 SOL), the network fee in lamports, and Simulation: Succeeded with compute units.

### TXL-AC-13 — Cancel and reject
- [ ] **Cancel**: the state becomes Cancelled and nothing appears on the explorer.
- [ ] Prepare another transfer, **Sign and submit**, and reject the request in the wallet: the state becomes Signing failed.

### TXL-AC-14 — Sign, confirm, reconcile
- [ ] Prepare a transfer, **Sign and submit**, and approve it in the wallet. The wallet shows exactly one SOL transfer to the destination.
- [ ] The timeline goes Submitted → Confirming → Confirmed, awaiting finalization → Reconciled (about 15–40 s; the page updates every 2 s).
- [ ] "Finalized balances match the expected changes." is shown. The signature link opens the transaction on the Devnet explorer.
- [ ] The destination's balance increased by 0.01 SOL. Within a minute, both wallets' indexed history shows the transfer with fee and SOL change.

### Local wallet signing
- [ ] On "Local dev", **Transfer SOL** 0.001 back to Wallet A. On the transaction page, enter the passphrase → **Sign and submit**. It reaches Reconciled.
- [ ] A wrong passphrase shows "The passphrase is incorrect." and the transaction stays in the signing step. You can retry with the correct passphrase.

### TXL-AC-11 — Simulation failure
- [ ] Transfer more SOL than the source holds: the state is Simulation failed with the simulation error, and no Sign button appears.

### TXL-AC-10 — Authorization
- [ ] As Wallet B with role `viewer` (set it in the owner console), the wallet page shows no **Transfer SOL**.

### TXL-AC-09 — Audit
- [ ] The owner audit log, filtered by resource type `transaction`, shows one event per state change. Worker steps (confirming, confirmed, reconciled) appear as actor type system.
- [ ] **Transactions** lists every transfer with its state.

---

## 4. Fallback RPC (SPEC-006 amendment), optional

- [ ] Set `SOLANA_RPC_FALLBACK_URL=https://api.testnet.solana.com` (deliberately the wrong cluster) and restart `pnpm dev`. **System** and the owner console list "Solana fallback RPC" as `UNAVAILABLE` with a genesis mismatch reason, and the runtime configuration shows the redacted fallback endpoint (PH-AC-08/09).
- [ ] Remove the variable and restart. Only the primary provider is listed.

---

## 5. Sign-off

| Iteration | Result | Date | Notes |
| --- | --- | --- | --- |
| 02 — Wallet Subsystem | | | |

Report any unchecked item so it can be fixed and the iteration marked `COMPLETE` in `checklist.md`.
