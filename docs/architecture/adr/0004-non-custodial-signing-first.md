# ADR-0004 — Non-Custodial Signing First; Keychain Boundary

Status: Accepted
Date: 2026-09-30

## Context

Private keys are the most sensitive asset in the system. The MVP runs on Devnet and must not pretend to be institutional custody, yet the architecture must allow HSM, KMS, MPC, custody providers, and multisig later.

## Decision

1. **Iteration 01–02:** signing happens in the browser through Wallet Standard wallets. The API prepares and simulates transactions but never signs user transactions and never receives private keys.
2. **Iteration 02 (local wallets):** optional client-side generated wallets (Web Crypto Ed25519 via `@solana/kit`), encrypted at rest in IndexedDB with AES-256-GCM using a PBKDF2-derived key (≥ 600,000 iterations), unlocked per session with a passphrase, with an explicit export flow and clear recovery warnings. Only public data reaches the API.
3. **Boundary:** all signing goes through a `TransactionSigner`-compatible interface, compatible with `@solana/keychain` backends (Memory, Vault, AWS KMS, GCP KMS, Fireblocks, Turnkey, Privy, …), so future backends are an infrastructure change.
4. **Custody changes require explicit human approval** and a new ADR.

## Alternatives considered

- **Server-side hot wallets in the MVP:** large attack surface, secret management burden, custody implications.
- **Third-party embedded wallets now:** adds a vendor dependency and possibly paid tiers before the need is proven.

## Consequences

- Automated server-initiated transactions (e.g. scheduled treasury operations) are out of scope until an approved server-side signing backend exists.
- E2E tests need a test-only Wallet Standard wallet (TESTING.md §7).
