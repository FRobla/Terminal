# Changelog

All functional changes to this project are recorded here: new features, changed or removed behavior, API changes, schema changes, security changes, transaction behavior, provider and data-source changes, architecture changes, and breaking changes.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/) once the first release is tagged.

## [Unreleased]

### Added
- Specification baseline (Iteration 00): README, ARCHITECTURE, SECURITY, DATA_SOURCES, API, TESTING, OPERATIONS, checklist, changelog, and `.env.example`.
- Specifications SPEC-001 through SPEC-008 with numbered acceptance criteria (`docs/specs/`).
- Architecture Decision Records ADR-0001 through ADR-0009 (`docs/architecture/adr/`).
- Domain model, database design, threat model, provider verification template, and UI guidelines.
- Agent operating rules (`CLAUDE.md`).
- `.gitignore` excluding environment files, build output, and local keypair files.

### Architecture
- Defined the target architecture: pnpm + Turborepo monorepo with `apps/terminal` (Next.js), `apps/api` (Fastify), `apps/worker` (BullMQ), PostgreSQL (Drizzle), and Redis.
- Selected `@solana/kit` and its official plugins as the Solana SDK; legacy `@solana/web3.js` is excluded.
- Defined Solana Devnet as the only permitted MVP cluster, verified by genesis hash.

### Data sources
- Documented Solana public Devnet RPC limits and cluster genesis hashes (verified 2026-09-30).
- Documented that Jupiter hosted APIs are Mainnet-only and require an API key on the free plan; the legacy `public.jupiterapi.com` endpoint must not be used.
- Marked X/Twitter data and an official pump.fun data API as `UNAVAILABLE`.
