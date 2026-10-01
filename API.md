# API

Status: **Baseline (Iteration 00).** Contract conventions and the endpoint catalog. Endpoints marked *(planned)* do not exist yet.

The API is served by `apps/api` (Fastify). The terminal reaches it on the same origin through Next.js rewrites (`/api/v1/*`). Contracts are Zod schemas in `packages/validation`; the OpenAPI document is generated from those schemas and served at `GET /api/v1/openapi.json` in non-production environments.

---

## 1. Conventions

| Topic | Convention |
| --- | --- |
| Versioning | Path prefix `/api/v1`. Breaking changes require `/api/v2` or a deprecation period recorded in the changelog. |
| Format | JSON, UTF-8, `camelCase` keys |
| Envelope (success) | `{ "data": <payload>, "meta": { "requestId": string, "generatedAt": ISO-8601 } }` |
| Timestamps | ISO-8601 UTC with milliseconds (`2026-09-30T18:04:12.345Z`) |
| On-chain amounts | Decimal **strings** of the raw integer amount (`"1500000000"`) plus `decimals`; never floating-point numbers |
| Display amounts | Optional `uiAmount` decimal string, computed server-side with exact integer arithmetic |
| Addresses / signatures | Base58 strings, validated server-side (`isAddress`, signature length) |
| Cluster | Every Solana-related response includes `cluster` |
| Request id | Clients may send `X-Request-Id` (UUID); the server generates one otherwise and always returns it in the header and `meta.requestId` |
| Authentication | Session cookie: `__Host-sct_session` over HTTPS; `sct_session` (without `Secure`) when `PUBLIC_APP_ORIGIN` is plain HTTP in local development — see [SECURITY.md](./SECURITY.md#5-authentication-and-sessions) |
| Origin | State-changing requests must carry `Origin` equal to `PUBLIC_APP_ORIGIN` (or `Sec-Fetch-Site: same-origin`), including public endpoints such as sign-in |
| CSRF | `X-CSRF-Token` header required on `POST`, `PUT`, `PATCH`, `DELETE` |
| Idempotency | `Idempotency-Key` header (UUID) required on side-effecting `POST` endpoints from Iteration 02 |
| Pagination | Cursor-based: `?limit=<1..100>&cursor=<opaque>`; response `meta.nextCursor` |
| Validation | Every request and response is validated. Unknown request keys are rejected. |
| Caching headers | Responses carrying external data include `Cache-Control: no-store` unless explicitly cacheable |

## 2. Sourced values

Any externally sourced value is returned in a `Sourced<T>` envelope ([SPEC-003](./docs/specs/SPEC-003-data-provenance.md)):

```json
{
  "status": "AVAILABLE",
  "value": { "lamports": "<integer string>", "decimals": 9, "uiAmount": "<decimal string>" },
  "provenance": {
    "source": "solana-rpc-devnet",
    "sourceType": "rpc",
    "provider": "solana-public-rpc",
    "endpoint": "https://api.devnet.solana.com",
    "method": "getBalance",
    "network": "devnet",
    "commitment": "confirmed",
    "slot": "<context slot>",
    "retrievedAt": "<ISO-8601>",
    "observedAt": "<ISO-8601 or null>",
    "requestId": "<uuid>",
    "dataVersion": "wallet-overview.v1",
    "confidence": "AUTHORITATIVE",
    "latencyMs": 142,
    "responseStatus": 200,
    "fallbackUsed": false
  }
}
```

Unavailable value:

```json
{
  "status": "UNAVAILABLE",
  "value": null,
  "unavailable": {
    "reason": "RPC_RATE_LIMITED",
    "message": "The Devnet RPC rate limit was reached.",
    "source": "solana-rpc-devnet",
    "lastSuccessfulRetrievalAt": null,
    "retry": { "retryable": true, "retryAfterMs": 10000, "attempts": 3 }
  },
  "provenance": null
}
```

## 3. Error format

```json
{
  "code": "WALLET_ADDRESS_INVALID",
  "message": "The provided value is not a valid Solana address.",
  "requestId": "<uuid>",
  "details": {}
}
```

Responses never include stack traces, SQL, secrets, database or provider credentials, private keys, or internal hostnames.

### 3.1 Error code catalog

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Request failed schema validation; `details.issues` lists paths and messages |
| `WALLET_ADDRESS_INVALID` | 400 | Not a valid base58 Solana address |
| `CLUSTER_MISMATCH` | 409 | Requested or wallet cluster differs from the API cluster |
| `UNAUTHENTICATED` | 401 | No valid session |
| `SESSION_EXPIRED` | 401 | Session expired or revoked |
| `FORBIDDEN` | 403 | Authenticated but missing the required permission |
| `CSRF_TOKEN_INVALID` | 403 | Missing or invalid CSRF token / origin |
| `SIWS_CHALLENGE_INVALID` | 400 | Challenge unknown, expired, or already used |
| `SIWS_SIGNATURE_INVALID` | 401 | Sign-in signature verification failed |
| `ACCOUNT_DISABLED` | 403 | The account was disabled by the owner; sign-in is refused |
| `NOT_FOUND` | 404 | Resource not found (domain-specific codes such as `WALLET_NOT_FOUND` from Iteration 02) |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key reused with a different payload |
| `OPERATION_NOT_ALLOWED` | 409 | The operation is refused for this target; `details.reason` is `SELF`, `OWNER_PROTECTED`, `NOT_A_MEMBER`, or `CURRENT_SESSION` |
| `RATE_LIMITED` | 429 | Client exceeded API rate limit; `Retry-After` header set |
| `RPC_UNAVAILABLE` | 503 | Solana RPC unreachable or failing |
| `RPC_RATE_LIMITED` | 503 | Upstream RPC rate limit reached; retry later |
| `CLUSTER_VERIFICATION_FAILED` | 503 | RPC genesis hash does not match configured cluster; Solana operations disabled |
| `PROVIDER_UNAVAILABLE` | 503 | External provider unavailable and no fallback |
| `NETWORK_NOT_PERMITTED` | 403 | Operation targets a cluster not permitted in this environment (e.g. mainnet-beta) |
| `INTERNAL_ERROR` | 500 | Unexpected error; details only in server logs, correlated by `requestId` |

Partial upstream failures inside an aggregate (e.g. token accounts unavailable while the balance is available) are **not** errors: the endpoint returns `200` with per-field `Sourced<T>` status.

## 4. Endpoints — Iterations 01 and 01.5

### 4.1 System

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/system/health` | Public | Liveness. `{ status: "ok" }` when the process is running. |
| `GET` | `/api/v1/system/readiness` | Public (no internals) | Readiness of PostgreSQL, Redis, and Solana cluster verification. Returns `503` when any dependency is not ready. |
| `GET` | `/api/v1/system/network` | Public | Cluster identity: `cluster`, `expectedGenesisHash`, `observedGenesisHash`, `verified`, `verifiedAt`, `rpcProvider`, `solanaCoreVersion`. |
| `GET` | `/api/v1/system/providers` | `system.read` | Provider health list ([SPEC-006](./docs/specs/SPEC-006-provider-health.md)). |
| `GET` | `/api/v1/openapi.json` | Public, non-production only | OpenAPI document generated from the Zod contracts. |

Readiness returns the body `{ status: "ready" | "not_ready", checks }` without the success envelope, so load balancers can read it directly.

### 4.2 Authentication ([SPEC-007](./docs/specs/SPEC-007-auth-and-rbac.md))

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/siws/challenge` | Public | Body `{ address }`. Returns SIWS input (domain, address, statement, uri, version, chainId, nonce, issuedAt, expirationTime). |
| `POST` | `/api/v1/auth/siws/verify` | Public | Body `{ challengeId, signedMessage, signature, address }`. Verifies Ed25519 signature, consumes challenge, creates session, sets cookie, audits `user.login`. |
| `GET` | `/api/v1/auth/session` | Session | Current user, active organization, permissions, CSRF token. |
| `POST` | `/api/v1/auth/logout` | Session | Revokes session, clears cookie, audits `user.logout`. |

### 4.3 Wallets ([SPEC-002](./docs/specs/SPEC-002-wallet-overview.md))

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/wallets/{address}/overview` | `wallet.read` | SOL balance, token accounts (SPL Token + Token-2022), recent signatures, each as `Sourced<T>`. Query: `signaturesLimit` (1–50, default 20). |
| `POST` | `/api/v1/wallets/connections` | Session | Body `{ address, walletName, walletChains[] }`. Returns `{ accepted, reason: "CLUSTER_MISMATCH" \| null, recordedAt }`; audits `wallet.connected` or `wallet.connection_rejected`. |

Response shape (`GET /wallets/{address}/overview`):

```
data: {
  address: string,
  cluster: "devnet",
  solBalance: Sourced<{ lamports: string, decimals: 9, uiAmount: string }>,
  tokenAccounts: Sourced<Array<{
    tokenAccount: string, mint: string, programId: string,
    tokenProgram: "spl-token" | "token-2022",
    amount: string, decimals: number, uiAmount: string,
    state: "initialized" | "frozen", isNative: boolean
  }>>,
  recentTransactions: Sourced<Array<{
    signature: string, slot: string, blockTime: string | null,
    status: "succeeded" | "failed", confirmationStatus: "processed" | "confirmed" | "finalized" | null,
    memo: string | null, explorerUrl: string
  }>>,
  explorerUrl: string
}
```

`memo` is untrusted external content and is rendered as plain text only.

### 4.4 Audit

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/audit/events` | `audit.read` | Paginated audit events for the active organization; filters `action`, `actorId`, `resourceType`, `from`, `to`. |

### 4.5 User settings ([SPEC-025](./docs/specs/SPEC-025-user-settings.md))

Every route acts on the session's own user.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/me/profile` | Session | User, sign-in wallet identities, active organization, roles, effective permissions |
| `PATCH` | `/api/v1/me/profile` | Session | Body `{ displayName: string \| null }` (1–64 characters, no control or format characters). Audits `user.profile_updated` |
| `GET` | `/api/v1/me/preferences` | Session | Effective preferences (stored values merged over defaults) |
| `PUT` | `/api/v1/me/preferences` | Session | Complete preferences object: `timeZone` (`local`/`utc`), `density`, `reduceMotion`, `explorer` (`solana-explorer`/`solscan`), `overviewRefreshSeconds` (0, 30, 60, 120), `keyboardShortcuts`, `addressDisplay` |
| `GET` | `/api/v1/me/sessions` | Session | The caller's active sessions; `current: true` marks the calling session |
| `POST` | `/api/v1/me/sessions/{sessionId}/revoke` | Session | Revokes one other session. Current session → `409 OPERATION_NOT_ALLOWED`; another user's → `404` |
| `POST` | `/api/v1/me/sessions/revoke-others` | Session | Revokes every other session; returns `{ revoked }` |
| `GET` | `/api/v1/announcements/current` | Session | The platform announcement, or `null` |

### 4.6 Owner console ([SPEC-026](./docs/specs/SPEC-026-owner-console.md))

Every route requires `platform.administer` (held only by `owner`). Member actions apply to the active organization and refuse the caller and owners (`OPERATION_NOT_ALLOWED`).

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/admin/overview` | Users, members, roles, active sessions, audit outcomes (24 h, active organization plus platform-level events), readiness, cluster, providers, last worker snapshot |
| `GET` | `/api/v1/admin/users` | Users with identities, membership, roles, active sessions, last activity, `protectedReason`. Cursor pagination (`limit` ≤ 100, `cursor` = last user id) |
| `PUT` | `/api/v1/admin/users/{userId}/role` | `{ roleKey }` — one of `admin`, `operator`, `trader`, `analyst`, `auditor`, `viewer`; replaces existing roles, creates or reactivates the membership. Audits `role.revoked` / `role.assigned` |
| `PUT` | `/api/v1/admin/users/{userId}/membership` | `{ status: active \| suspended }`. Audits `member.suspended` / `member.reactivated` |
| `PUT` | `/api/v1/admin/users/{userId}/status` | `{ status: active \| disabled }`; disabling revokes every session. Audits `user.disabled` / `user.enabled` |
| `POST` | `/api/v1/admin/users/{userId}/sessions/revoke` | Revokes all of the user's sessions |
| `GET` | `/api/v1/admin/sessions` | Active sessions platform-wide (≤ 500), with user, wallet, IP address, user agent |
| `POST` | `/api/v1/admin/sessions/{sessionId}/revoke` | Revokes one session (not the caller's current one) |
| `GET` / `PATCH` | `/api/v1/admin/organization` | Organization with member counts / `{ name }` (1–100 characters). Audits `organization.updated` |
| `GET` | `/api/v1/admin/roles` | Permission catalog and role matrix from the database, with active member counts |
| `PUT` | `/api/v1/admin/announcement` | `{ enabled, severity: info \| warning \| critical, message }` (≤ 500 characters, plain text). Audits `announcement.updated` |
| `GET` | `/api/v1/admin/system/runtime` | Allowlisted configuration (redacted RPC endpoint, no secrets), API process facts, PostgreSQL and Redis facts — each dependency section is `AVAILABLE` (with `latencyMs`) or `UNAVAILABLE` (with `reason`, `source`) |
| `POST` | `/api/v1/admin/system/cluster/verify` | Re-verifies the genesis hash now (6/min). Audits `system.cluster_verification_requested` |
| `GET` | `/api/v1/admin/system/provider-history` | Worker health snapshots, newest first. Query `providerId`, `limit` (≤ 500, default 60) |
| `GET` | `/api/v1/admin/jobs` | BullMQ queue state: workers, counts, schedulers, recent completed and failed jobs |
| `POST` | `/api/v1/admin/jobs/provider-health/run` | Enqueues one provider health probe (6/min). Audits `system.job_enqueued` |
| `GET` | `/api/v1/admin/developer/routes` | Every registered route with method, path, and access (`public`, `session`, or permission) |
| `POST` | `/api/v1/admin/developer/cache/purge` | `{ target: wallet-overview \| permissions }`; returns `{ keysDeleted }`. Audits `system.cache_purged` |

The owner's audit log viewer uses `GET /api/v1/audit/events` (§4.4).

## 5. Planned endpoints

| Iteration | Resource | Examples |
| --- | --- | --- |
| 02 | Wallet registry | `GET/POST /api/v1/wallets`, `GET/PATCH /api/v1/wallets/{walletId}`, `GET /api/v1/wallets/{walletId}/transactions` |
| 02 | Transactions | `POST /api/v1/transactions` (prepare), `POST /api/v1/transactions/{id}/simulate`, `POST /api/v1/transactions/{id}/submit`, `GET /api/v1/transactions/{id}` |
| 03 | Portfolio | `GET /api/v1/portfolio`, `GET /api/v1/portfolio/snapshots` |
| 03 | Market data | `GET /api/v1/market-data/prices?mints=` |
| 04 | Trading | `POST /api/v1/trading/quotes`, `POST /api/v1/trading/swaps` |
| 05 | Token Studio | `POST /api/v1/tokens/drafts`, `POST /api/v1/tokens/drafts/{id}/simulate`, `GET /api/v1/tokens/{mint}/authorities` |
| 06 | Intelligence | `GET /api/v1/intelligence/tokens/{mint}/facts` |
| 07 | Alerts, notifications, watchlists | `GET/POST /api/v1/alerts`, `GET /api/v1/notifications`, `GET/POST /api/v1/watchlists` |
| 08 | Organizations, users, roles | `GET/POST /api/v1/organizations`, `/members`, `/roles` |
