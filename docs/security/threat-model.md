# Threat Model

Status: Baseline (Iteration 00). Reviewed at the start of every iteration that adds a new trust boundary or sensitive action.

## 1. Assets

| Asset | Sensitivity |
| --- | --- |
| Private keys / seed material (browser wallets, local encrypted wallets) | Critical |
| Transaction intent and signing flow integrity | Critical |
| Sessions and authentication challenges | High |
| Authorization data (memberships, roles, permissions) | High |
| Audit log integrity | High |
| Provider API keys, database and Redis credentials, `AUTH_SECRET`, `ENCRYPTION_KEY` | High |
| Wallet metadata (labels, purposes, organization assignments) | Medium (confidential business data) |
| Displayed financial data integrity (balances, prices, provenance) | High (decisions are made on it) |

## 2. Trust boundaries

```
[Browser + wallet extension] ──(1)── [Terminal (Next.js)] ──(2)── [API] ──(3)── [PostgreSQL / Redis]
                                                                     └──(4)── [Solana RPC / external providers]
[Worker] ──(3)── [PostgreSQL / Redis]      [Worker] ──(4)── [Solana RPC / external providers]
```

1. User-controlled browser environment; wallet is a separate trust domain.
2. Same-origin HTTP with session cookie and CSRF token.
3. Internal network; least-privilege credentials.
4. Untrusted external data sources.

## 3. Threats and mitigations (STRIDE)

| # | Threat | Category | Mitigation | Iteration |
| --- | --- | --- | --- | --- |
| T1 | Attacker points the app at a Mainnet RPC or a malicious RPC | Spoofing / Tampering | Genesis-hash verification; Mainnet rejected by config; RPC URL only from server env | 01 |
| T2 | Transaction shown to the user differs from what the wallet signs | Tampering | Server-built review from decoded bytes; message hash comparison before submission; simulation required | 02 |
| T3 | Malicious external instructions (e.g. aggregator response) drain funds | Tampering / Elevation | Decode and simulate; unknown programs labeled and acknowledged; expected-effects check | 04 |
| T4 | Private key leakage via logs, telemetry, errors, API | Information disclosure | Keys never leave the browser; central redaction; tests on log output; no key fields in contracts | 01–02 |
| T5 | Session hijacking / fixation | Spoofing | `__Host-` HttpOnly Secure SameSite=Strict cookies; hashed session ids; rotation at sign-in; idle and absolute expiry | 01 |
| T6 | SIWS replay or cross-domain signature reuse | Spoofing | Single-use nonce; domain/URI/chain/expiry binding; server-built message | 01 |
| T7 | CSRF on state-changing endpoints | Tampering | SameSite=Strict + Origin check + synchronizer token | 01 |
| T8 | Broken access control across organizations | Elevation / Disclosure | Default-deny route permissions; org-scoped queries; generated authorization matrix tests | 01 |
| T9 | XSS through token metadata, memos, or social content | Tampering / Elevation | React escaping; no raw HTML; nonce-based CSP; sanitization of control/bidi characters | 01 |
| T10 | Phishing tokens (lookalike names, fake logos, fake links) | Spoofing | Metadata treated as untrusted; no legitimacy implied; mint address always shown; homoglyph flags | 03–06 |
| T11 | Prompt injection through external content into AI analysis | Tampering | Delimited untrusted content; schema-validated outputs; AI cannot trigger actions | 09 |
| T12 | Provider returns manipulated or malformed data | Tampering | Schema validation; provenance; source-of-truth hierarchy; conflict surfacing | 01+ |
| T13 | Resource exhaustion (API abuse, RPC budget exhaustion) | Denial of service | Per-session/IP rate limits; distributed provider budgets; bounded polling | 01 |
| T14 | Audit log tampering or deletion | Repudiation | Append-only privileges; request id correlation | 01 |
| T15 | Supply-chain compromise of a dependency | Tampering | Lockfile pinning; audit in CI; lifecycle script allowlist; official Solana scopes only | 01 |
| T16 | Secret leakage via repository | Disclosure | `.env` ignored; secret scanning in CI (e.g. gitleaks) | 01 |
| T17 | Local encrypted wallet brute force after device compromise | Disclosure | PBKDF2 ≥ 600k iterations; strong passphrase guidance; explicit "not institutional custody" warning | 02 |
| T18 | Stale data presented as current, leading to wrong decisions | Tampering (integrity) | Freshness display; stale thresholds; no silent cache reuse | 01 |

## 4. Out of scope for the MVP

- Compromised user device or malicious wallet extension (mitigated only by user education and wallet choice).
- Nation-state adversaries; physical attacks.
- Mainnet economic attacks (MEV, sandwiching) — addressed before Mainnet readiness.

## 5. Review log

| Date | Iteration | Change |
| --- | --- | --- |
| 2026-09-30 | 00 | Initial threat model |
