# ADR-0008 — Devnet DEX Strategy

Status: **Proposed** (confirm before Iteration 04)
Date: 2026-09-30

## Context

The brief names Jupiter as the primary routing integration. Verification on 2026-09-30 found:

- Jupiter's hosted APIs (Swap, Ultra, Price, Tokens) are **Mainnet-only**; they cannot quote or build swaps against Devnet liquidity.
- The Jupiter free plan requires an API key and allows 1 request/s (60/min, shared across Swap, Price, and Token requests).
- The legacy `public.jupiterapi.com` endpoint is scheduled to shut down on 2026-10-14 and must not be used.
- Orca Whirlpools publishes an on-chain SDK (`@orca-so/whirlpools`, built on `@solana/kit`) supporting Mainnet and Devnet; Devnet pools exist (e.g. a SOL/devUSDC test pool) but liquidity is sparse and prices are not market prices.

Since the MVP forbids Mainnet transactions, executing swaps through Jupiter is impossible during the MVP.

## Decision (proposed)

- Define a `DexProvider` port with capabilities `quote`, `buildSwap`, and `supportedNetworks`.
- **Devnet execution:** `OrcaWhirlpoolsAdapter` computes quotes and swap instructions from on-chain Devnet pools within our RPC budget. Quotes are labeled "Devnet test liquidity — not a market price".
- **Jupiter:** `JupiterAdapter` implemented for Mainnet, used in the MVP only for **read-only** quotes/prices if the owner approves displaying Mainnet reference data (ADR-0009). Its execution path is disabled by the network policy until Mainnet readiness.
- Capability `trading.execute` is `UNAVAILABLE` for pairs without a Devnet pool.

## Alternatives considered

- **Mock swaps on Devnet:** forbidden (fake functionality).
- **Deploying our own AMM on Devnet:** high effort, not representative.
- **Raydium on Devnet:** possible alternative adapter; verify SDK compatibility with `@solana/kit` before choosing.

## Consequences

- The trading UI and transaction lifecycle are exercised end-to-end on Devnet with real transactions.
- Jupiter routing and aggregation behavior is validated only on Mainnet later.
