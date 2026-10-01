# Security

Status: **Baseline (Iteration 00).** This document defines security requirements. Controls are marked with the iteration in which they are implemented.

Related: [Threat model](./docs/security/threat-model.md) · [SPEC-005 Network safety](./docs/specs/SPEC-005-network-safety.md) · [SPEC-007 Auth and RBAC](./docs/specs/SPEC-007-auth-and-rbac.md) · [SPEC-008 Audit logging](./docs/specs/SPEC-008-audit-logging.md)

---

## 1. Security posture

- The MVP runs on **Solana Devnet** only. Devnet assets have no monetary value, but the system is engineered as if they did, because the same code paths will eventually run on Mainnet.
- The MVP is **not** an institutional custody solution and must never be described as one.
- Security outranks every other quality attribute (see [ARCHITECTURE.md](./ARCHITECTURE.md#1-context-and-goals)).

## 2. Key management

### 2.1 Absolute rules

Private keys and seed material are never:

- logged, traced, or included in metrics;
- sent to analytics or error reporting;
- stored in plaintext in PostgreSQL, Redis, files, or browser `localStorage`/`sessionStorage`;
- returned by any API response;
- included in error messages or audit metadata;
- transmitted to the backend.

### 2.2 MVP model (Iteration 01–02)

1. **Primary: non-custodial browser wallets** through the Wallet Standard (`@solana/kit-plugin-wallet`). The user's wallet signs; the terminal never sees the key.
2. **Locally generated wallets (Iteration 02, [ADR-0004](./docs/architecture/adr/0004-non-custodial-signing-first.md)):**
   - Keys are generated client-side with Web Crypto (Ed25519) through `@solana/kit`.
   - The private key is only extractable for an explicit, confirmed export flow.
   - Persisted material is encrypted with AES-256-GCM using a key derived from a user passphrase (PBKDF2-SHA-256, ≥ 600,000 iterations, random 16-byte salt, random 12-byte IV) and stored in IndexedDB.
   - Unlock requires an authenticated session plus the passphrase; the decrypted key lives in memory only for the signing operation.
   - The user is warned that the terminal cannot recover a lost passphrase or key.
   - Only the public address, label, purpose, and ownership metadata are sent to the API.

As built (Iteration 02, SPEC-010):
- The seed comes from `crypto.getRandomValues` and is imported as a non-extractable Web Crypto key; no Web Crypto key is ever extractable.
- The AES-GCM ciphertext authenticates the address as additional data, and records are never overwritten.
- Every signature asks for the passphrase again; there is no unlocked state.
- Export first records `wallet.exported` through the API (`wallet.export`), then downloads a Solana CLI key file. The material is never displayed or copied.
- An e2e test records every request during create, sign, and export, and asserts that no passphrase, ciphertext, salt, IV, or secret key appears.
- Because the encrypted key is on the user's device, the export permission is an audit and policy gate, not a cryptographic one.

### 2.3 Future path

Signing is accessed through a `TransactionSigner` boundary compatible with `@solana/keychain`, so that KMS, HSM, MPC, institutional custody, or multisig backends can be introduced without changing domain code. Any change to custody architecture requires explicit human approval.

## 3. Signing policy

- The server never signs user transactions in the MVP.
- Before any signature request, the terminal shows a human-readable review produced by the API: cluster, fee payer, signers, programs invoked (with unknown programs clearly labeled `UNKNOWN PROGRAM`), writable accounts, expected token and SOL movements, fees, and the simulation result.
- Externally sourced instructions or transactions (e.g. from a DEX aggregator) are decoded and simulated before being presented; they are never blindly passed to the wallet.
- Explicit confirmation is required for every signature. No auto-sign, no "remember my choice".
- Every transaction is tracked through the lifecycle state machine ([SPEC-004](./docs/specs/SPEC-004-transaction-lifecycle.md)).
- As built (Iteration 02):
  - The API stores the SHA-256 of the reviewed message and refuses a submitted transaction whose message differs or whose fee-payer signature does not verify. Nothing is sent in that case (TXL-AC-12).
  - Only the user who prepared a transaction may sign or submit it.
  - Wallets that only offer sign-and-send are refused.
  - Unknown programs or address lookup tables require an explicit acknowledgement.
- Proof of control: registering a browser or local wallet requires a signature over a server-built, single-use text challenge bound to the organization, user, address, and cluster (SPEC-009). The text states that no transaction is authorized and cannot be parsed as a transaction.

## 4. Network safety

- The cluster is configured explicitly (`SOLANA_CLUSTER`) and verified against the RPC genesis hash at startup and periodically.
- `mainnet-beta` is rejected by the configuration schema in the MVP.
- The connected wallet's chain must match the application cluster; a mismatch blocks signing flows.
- Every transaction record carries its cluster; cross-cluster operations are rejected.
- The UI permanently displays the network (`SOLANA DEVNET`).

Details: [SPEC-005](./docs/specs/SPEC-005-network-safety.md).

## 5. Authentication and sessions

- Proposed approach: Sign-In With Solana (SIWS) through the Wallet Standard `solana:signIn` feature (with a signed-message fallback), creating a server-side session. See [ADR-0005](./docs/architecture/adr/0005-authentication.md).
- Challenges are single-use, bound to domain, URI, cluster, nonce, issued-at and expiration (≤ 5 minutes), and stored server-side.
- Session identifiers are opaque random values (≥ 256 bits); only a hash is stored in PostgreSQL.
- Cookie: `__Host-` prefix, `HttpOnly`, `Secure` (except local HTTP development), `SameSite=Strict`, `Path=/`.
- Absolute session lifetime 12 hours, idle timeout 30 minutes (configurable). Logout revokes the session server-side.
- Login, logout, and failed login attempts are audited.

## 6. Authorization (RBAC)

- Explicit permissions (e.g. `wallet.read`, `wallet.create`, `trading.execute`); roles are sets of permissions; users hold roles per organization.
- **Default deny.** Every protected route declares its required permission; routes without a declaration fail a startup check.
- Authorization happens in the API for every protected operation, scoped to the active organization. Frontend checks are UX only.
- Application wallet roles (Creator, Funder, Controller, Viewer) are distinct from Solana protocol authorities (mint, freeze, update, …) and are never conflated.
- Role and permission changes are audited.
- **Owner-only administration (Iteration 01.5).** `platform.administer` gates every `/api/v1/admin/*` route (the owner console, SPEC-026) and is held only by the `owner` role; `admin` holds every other permission. Console actions never target the caller or another owner, never grant ownership, and are reversible (suspend, disable, revoke) rather than destructive. Disabling an account revokes its sessions and blocks new sign-ins (`ACCOUNT_DISABLED`).
- **Self-service (Iteration 01.5).** `/api/v1/me/*` routes act only on the session's own user; another user's session id is reported as not found.

Full permission catalog: [SPEC-007](./docs/specs/SPEC-007-auth-and-rbac.md).

## 7. Audit logging

Every sensitive action produces an append-only audit event with actor, organization, action, resource, resource id, timestamp, request id, IP and user agent where appropriate, result, and sanitized metadata. Audit metadata never contains secrets. The application database role has no `UPDATE` or `DELETE` privilege on the audit table. Details: [SPEC-008](./docs/specs/SPEC-008-audit-logging.md). Iteration 01.5 adds profile, session, membership, account, organization, announcement, and system-maintenance actions (SPEC-008 amendment 2026-10-01).

## 8. Web application security

| Control | Requirement | Iteration |
| --- | --- | --- |
| Content Security Policy | Nonce-based `script-src` with `'strict-dynamic'`, nonce-based `style-src` (development only: `'unsafe-inline'` without a nonce, for Next.js hot-reload and overlay `<style>` elements), `style-src-attr 'unsafe-inline'` (inline style attributes cannot execute script; used by React and Radix positioning), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `connect-src 'self'` (the browser talks only to its own origin). Implemented in `apps/terminal/src/proxy.ts`. The API sends `default-src 'none'` | 01 |
| Security headers | `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal; `@fastify/helmet` on the API | 01 |
| CSRF | `SameSite=Strict` cookies + `Origin`/`Sec-Fetch-Site` verification + synchronizer token header (`X-CSRF-Token`) on every state-changing request | 01 |
| CORS | Disabled (same-origin via Next.js rewrites); explicit allowlist only if a separate origin is ever required | 01 |
| Input validation | Zod schema on every request (params, query, body, headers used); unknown keys rejected | 01 |
| Output validation | Zod schema on every response; database models never exposed directly | 01 |
| Output encoding | React escaping; no `dangerouslySetInnerHTML` with external content; external URLs rendered as non-clickable text unless allowlisted scheme (`https:`) and marked as external | 01 |
| Rate limiting | `@fastify/rate-limit` backed by Redis, per session and per IP; stricter limits on auth endpoints (`AUTH_RATE_LIMIT_PER_MINUTE`, default 20); owner-console actions that reach the RPC are limited to 6 per minute | 01 / 01.5 |
| Error handling | Consistent error format; no stack traces, SQL, credentials, provider keys, or internal hostnames in responses | 01 |
| Idempotency | `Idempotency-Key` on side-effecting endpoints | 02 |

## 9. Secret management

- Secrets come from environment variables validated at startup; the process fails fast when a required secret is missing or malformed.
- `.env` files are git-ignored. Only `.env.example` (no real values) is committed.
- Provider credentials are never hardcoded and never sent to the browser. Provider endpoints are redacted (query-string keys stripped) before being stored in provenance or logs.
- Each environment has separate secrets. Mainnet (future) has fully separate credentials, encryption keys, database, and wallet infrastructure.
- Secret rotation procedure: [OPERATIONS.md](./OPERATIONS.md#runbooks).

## 10. Logging and telemetry

- Central `pino` redaction for paths such as `*.privateKey`, `*.secretKey`, `*.seed`, `*.mnemonic`, `*.passphrase`, `*.password`, `authorization`, `cookie`, `set-cookie`, `*.apiKey`, `*.token`, `*.signature` inside auth payloads.
- Request and response bodies are not logged by default.
- A test asserts that known secret shapes never appear in log output (see [TESTING.md](./TESTING.md)).

## 11. External data trust model

All external content is **untrusted**: API responses, token metadata (names, symbols, URIs, images, descriptions), social posts, websites, transaction memos, external wallet labels, and GitHub content.

- Validated with schemas before entering the domain; invalid payloads are rejected and the provider health is updated.
- Length-limited and normalized (Unicode control and bidirectional-override characters stripped for display; homoglyph-prone symbols flagged).
- Never executed, never interpreted as instructions, never used to build URLs to internal services.
- Off-chain metadata images are loaded through a restricted image policy (no SVG from untrusted origins; size limits).
- A token is never presented as legitimate because it has a logo, metadata, social links, liquidity, volume, or many holders.

## 12. Prompt injection protection *(Iteration 09)*

- AI components receive external content only inside explicit delimiters (`<external_data>…</external_data>`) with a system instruction that such content is data, not instructions.
- AI output is schema-validated; claims must reference evidence records; outputs cannot trigger actions (no tool calls that sign, submit, or change configuration).
- AI output is labeled as such and classified as Observed, Derived, Inference, Hypothesis, or Unknown.

## 13. Dependency and supply-chain security

- Exact versions pinned via `pnpm-lock.yaml`; `pnpm install --frozen-lockfile` in CI.
- `pnpm audit` (or OSV scanner) in CI; Dependabot/Renovate for update PRs.
- New dependencies must pass the dependency policy (necessary, maintained, meaningful, not duplicated, acceptable risk and bundle cost).
- pnpm settings: lifecycle scripts restricted to an allowlist (`onlyBuiltDependencies`).
- Solana packages are verified to come from the official `@solana/*` and `@solana-program/*` scopes.
- pnpm 12 enforces a minimum release age for newly published versions. Versions pinned at initialization that were younger than that window are listed explicitly under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`; remove them at the next dependency update.
- Accepted advisories (2026-09-30): two esbuild advisories reported by `pnpm audit` affect only esbuild's development server (`drizzle-kit` → `@esbuild-kit` → esbuild ≤ 0.24.2, moderate; `tsup` → esbuild 0.27.x on Windows, low). The project never runs esbuild's server; re-check on each dependency update. CI fails on high or critical advisories.
- Source files must not contain invisible Unicode characters (bidirectional controls, zero-width characters); use explicit `\u` escapes. One such case was found and fixed in Iteration 01.

## 14. Vulnerability reporting

Report suspected vulnerabilities privately to the repository owner. Do not open public issues for security problems. (A formal disclosure policy will be added before any external release.)

## 15. Security gates before Mainnet

Mainnet may not be enabled until every item in [OPERATIONS.md — Mainnet readiness gate](./OPERATIONS.md#mainnet-readiness-gate) is complete, reviewed, and explicitly approved by a human owner.
