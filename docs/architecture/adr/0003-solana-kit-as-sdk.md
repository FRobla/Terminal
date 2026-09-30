# ADR-0003 — `@solana/kit` as the Solana SDK

Status: Accepted
Date: 2026-09-30

## Context

Official Solana documentation (checked 2026-09-30) recommends `@solana/kit` for new TypeScript applications, assembled from composable plugins, with React bindings and generated program clients. Legacy `@solana/web3.js` remains available but is not recommended for new work.

## Decision

- Core: `@solana/kit` (8.x at decision time).
- Plugins: `@solana/kit-plugin-rpc` (RPC and sending), `@solana/kit-plugin-signer` (fee payer / identity / signers), `@solana/kit-plugin-wallet` (Wallet Standard connection).
- React: `@solana/react`.
- Program clients: `@solana-program/system`, `@solana-program/token`, `@solana-program/token-2022`, `@solana-program/compute-budget`, `@solana-program/memo`.
- Future signing backends: `@solana/keychain` (see ADR-0004).
- All Solana access in the backend is wrapped by `packages/solana` readers and builders so that plugin API changes (plugins are `0.x`) are contained.
- `@solana/web3.js` is not a dependency. A third-party SDK that requires it (e.g. some DEX SDKs) needs a new ADR.

## Alternatives considered

- **`@solana/web3.js` v1:** legacy, class-based, not tree-shakeable, not recommended for new apps.
- **Direct JSON-RPC over fetch:** loses types, codecs, and signer abstractions.

## Consequences

- Amounts are `bigint`; codecs are explicit.
- Plugin upgrades must be reviewed against release notes; exact pins required.
