# ADR-0009 — Valuation Policy for Devnet Assets

Status: **Proposed** (confirm before Iteration 03)
Date: 2026-09-30

## Context

Devnet SOL and Devnet tokens have no market value. Every price API describes Mainnet markets. The brief forbids hardcoded prices and requires every valuation to identify asset, price, price source, price timestamp, and quote currency.

## Decision (proposed)

1. The portfolio **USD value of Devnet assets is `UNAVAILABLE`** with reason `NOT_SUPPORTED_ON_NETWORK` ("Devnet assets have no market price").
2. Optionally, the terminal may show a **Mainnet reference price** for SOL (and for tokens whose mint address also exists on Mainnet, which is rare), clearly labeled `MAINNET REFERENCE — not the value of Devnet assets`, with source and timestamp, and never summed into a portfolio total.
3. Portfolio aggregation on Devnet reports quantities (lamports, raw token amounts) and allocation by quantity only.

## Alternatives considered

- **Multiply Devnet balances by Mainnet prices:** misleading; rejected.
- **Hide valuation entirely:** acceptable fallback if option 2 is not approved.

## Consequences

- Valuation code paths are fully built and tested (including Mainnet read-only price adapters) but produce `UNAVAILABLE` on Devnet by design.
- On future Mainnet, the same code paths produce real valuations without a rewrite.

## Open question for the owner

Approve showing labeled Mainnet reference prices (option 2), or keep valuation hidden on Devnet.
