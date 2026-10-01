# SPEC-007 — Authentication and RBAC

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED (Iteration 01 foundation scope) |
| Iteration | 01 (foundation), 08 (full organization management) |
| Domain(s) | `auth`, `organizations`, `users`, `roles` |
| Criteria prefix | `AUTH`, `RBAC` |
| Related | ADR-0005, SECURITY.md §5–6, SPEC-008 |

## 1. Problem and goal

Identify users, bind them to organizations, and authorize every protected backend operation with explicit permissions. Frontend checks are UX; backend checks are security.

## 2. Scope

Iteration 01: Sign-In With Solana, server-side sessions, CSRF, organizations/memberships/roles/permissions schema, system roles, permission enforcement with default deny, a bootstrap owner for the first organization.

Iteration 08: membership management UI, teams, custom roles, invitations, API credentials, additional identity methods (e.g. email/OIDC) if approved.

## 3. Authentication flow (SIWS)

1. `POST /auth/siws/challenge { address }` → server creates a single-use challenge (`nonce` 128-bit random, `issuedAt`, `expirationTime` = +5 min, `domain` and `uri` from `PUBLIC_APP_ORIGIN`, `chainId` from the cluster, `statement` "Sign in to Solana Corporate Terminal. This request does not trigger a blockchain transaction or cost any fees.") and returns the SIWS input.
2. The terminal calls the wallet's `solana:signIn` feature with that input; if unsupported, it constructs the identical SIWS message text server-provided and calls `solana:signMessage`.
3. `POST /auth/siws/verify` → server rebuilds the expected message from the stored challenge, verifies the Ed25519 signature against the address, checks domain/URI/nonce/expiry/cluster, marks the challenge consumed, and creates a session.
4. The user is resolved by wallet identity (`user_wallet_identities`). Unknown identities: a user record is created with no organization membership unless the address equals `BOOTSTRAP_OWNER_WALLET_ADDRESS` and the target organization has no owner, in which case the user becomes `owner` of the default organization (audited).
5. A user without any membership can sign in but has no permissions; the terminal shows "Your account is not a member of any organization. Ask an administrator for access."

A sign-in wallet identity is distinct from operational wallets. Signing in with a wallet does not register it as an organization wallet.

## 4. Sessions

- Opaque 256-bit session id in cookie `__Host-sct_session`; only SHA-256 hash stored.
- Absolute TTL `SESSION_TTL_SECONDS` (default 12 h), idle timeout `SESSION_IDLE_TIMEOUT_SECONDS` (default 30 min), sliding on activity.
- Active organization stored on the session; switching organization is an explicit call (Iteration 08).
- CSRF token bound to the session, returned by `GET /auth/session`, required as `X-CSRF-Token` on state-changing requests; `Origin` must equal `PUBLIC_APP_ORIGIN`.

## 5. Permission catalog

| Permission | Description |
| --- | --- |
| `organization.read` | View organization details and members |
| `organization.manage` | Manage organization settings, members, roles |
| `wallet.read` | View wallet overviews, balances, history |
| `wallet.create` | Create/register wallets |
| `wallet.export` | Export public keys or recovery material (explicit flow) |
| `wallet.fund` | Initiate funding transfers |
| `wallet.control` | Initiate transactions from managed wallets |
| `trading.read` | View trading data |
| `trading.quote` | Request quotes |
| `trading.execute` | Execute swaps |
| `token.read` | View token data |
| `token.create` | Create tokens |
| `token.manage` | Change token authorities/metadata |
| `intelligence.read` | View intelligence |
| `alerts.read` | View alerts |
| `alerts.manage` | Create/modify alerts |
| `audit.read` | View audit log |
| `system.read` | View system and provider health |
| `system.manage` | Manage providers and system settings |

## 6. System roles (seeded)

| Role | Permissions |
| --- | --- |
| `owner` | All |
| `admin` | All except transferring ownership (Iteration 08) |
| `operator` | `organization.read`, `wallet.*`, `token.read`, `trading.read`, `trading.quote`, `intelligence.read`, `alerts.*`, `system.read` |
| `trader` | `organization.read`, `wallet.read`, `trading.*`, `token.read`, `intelligence.read`, `alerts.read` |
| `analyst` | `organization.read`, `wallet.read`, `trading.read`, `trading.quote`, `token.read`, `intelligence.read`, `alerts.read` |
| `auditor` | `organization.read`, `wallet.read`, `audit.read`, `system.read` |
| `viewer` | `organization.read`, `wallet.read`, `token.read`, `trading.read`, `intelligence.read`, `alerts.read` |

## 7. Enforcement

- Each route declares `requiredPermission` (or `public: true`). A startup check fails if any route lacks a declaration.
- Authorization evaluates the session's active organization membership; permissions are cached per session for at most 60 s and invalidated on role change.
- `403 FORBIDDEN` responses do not reveal whether the resource exists in another organization.

## 8. Acceptance criteria

### AUTH-AC-01 — Challenge issuance
Given a valid address
When a challenge is requested
Then a single-use challenge with nonce, domain, URI, chain id, issued-at, and 5-minute expiration is stored and returned.

### AUTH-AC-02 — Successful sign-in
Given a valid signature over the challenge message
When verify is called
Then a session is created, the `__Host-sct_session` cookie is set with `HttpOnly`, `Secure` (non-local), `SameSite=Strict`, `Path=/`, and `user.login` is audited.

### AUTH-AC-03 — Replay and tampering rejected
Given a consumed, expired, or unknown challenge, a signature from a different key, or a message whose domain/URI/nonce differs
When verify is called
Then it fails (`SIWS_CHALLENGE_INVALID` or `SIWS_SIGNATURE_INVALID`) and `user.login_failed` is audited with the reason.

### AUTH-AC-04 — Session expiry
Given a session idle beyond the idle timeout or older than the absolute TTL
When any protected endpoint is called
Then it returns `401 SESSION_EXPIRED`.

### AUTH-AC-05 — Logout
Given an active session
When logout is called
Then the session is revoked server-side, the cookie is cleared, `user.logout` is audited, and the old cookie no longer authenticates.

### AUTH-AC-06 — CSRF
Given a state-changing request without a valid `X-CSRF-Token` or with a foreign `Origin`
When it reaches the API
Then it is rejected with `403 CSRF_TOKEN_INVALID`.

### RBAC-AC-01 — Default deny
Given a route without a permission declaration
When the API starts
Then startup fails.

### RBAC-AC-02 — Permission enforcement matrix
Given each seeded role and each protected route
When the route is called
Then access is granted exactly when the role holds the required permission (generated matrix test).

### RBAC-AC-03 — No membership, no access
Given a signed-in user with no organization membership
When any protected route is called
Then it returns `403 FORBIDDEN`.

### RBAC-AC-04 — Bootstrap owner
Given the default organization has no owner and `BOOTSTRAP_OWNER_WALLET_ADDRESS` is set
When that address signs in for the first time
Then the user becomes `owner` of the default organization and `role.assigned` is audited; subsequent sign-ins by other addresses receive no automatic membership.

## Amendments

- **2026-09-30 (Iteration 01) — Local cookie name:** `__Host-` cookies require `Secure`, which browsers honor only over HTTPS. When `PUBLIC_APP_ORIGIN` uses `http:` (local development), the cookie is `sct_session` without `Secure`; over HTTPS it is `__Host-sct_session` with `Secure`.
- **2026-09-30:** sessions also store the signed-in wallet address. Permission changes take effect on the next sign-in or after the ≤ 60 s permission cache expires.
- **2026-09-30:** denied permission checks are audited as `authorization.denied` (AUD-AC-04).
- **2026-10-01 (Iteration 01) — Status-bar sign-in (owner request):** sign-in was reachable only from the Wallet panel after connecting a wallet. Added criterion AUTH-AC-07:

  ### AUTH-AC-07 — Sign-in from the status bar
  Given a signed-out user on any page
  When at least one Devnet-capable wallet is detected
  Then the status bar shows one `Connect <wallet name>` button per detected wallet, which connects that wallet and signs in with it in a single action (signed in without a connected wallet, they only connect); the Wallet panel no longer lists wallets. When no Devnet wallet is detected or the connected account lacks Devnet, the status bar states why instead of offering the buttons.
- **2026-10-01 (Iteration 01) — Temporary default member role (owner request):** until membership management ships (Iteration 08), the owner wants every new user to have full use of the terminal. `DEFAULT_MEMBER_ROLE` (optional; one of the non-owner system roles) relaxes §3.4/RBAC-AC-04's "no automatic membership" only when set. RBAC-AC-03 still holds when it is unset. Remove this mechanism once Iteration 08 delivers invitations.

  ### RBAC-AC-05 — Default member role
  Given `DEFAULT_MEMBER_ROLE` is set and `APP_ENV` is not `production`
  When a user with no active membership signs in (after the bootstrap-owner check)
  Then they become a member of the default organization with that system role, `role.assigned` is audited with reason `default member role`, and users who already hold a membership (including the bootstrap owner) are unchanged. Configuration with `APP_ENV=production` is rejected at startup, and `owner` is not an accepted value.
- **2026-10-01 (Iteration 01.5) — Owner-only permission (owner request, SPEC-026):** added `platform.administer` ("Operate the owner console: platform administration and developer tooling") to §5. It is held only by `owner`; `admin` now holds every permission except it (§6 previously read "All except transferring ownership"; that exception remains planned for Iteration 08). RBAC-AC-02's generated matrix covers it.
- **2026-10-01 (Iteration 01.5) — Disabled accounts:** sign-in verification refuses users whose account is disabled with `403 ACCOUNT_DISABLED` and audits `user.login_failed` with reason `account disabled` (previously the session was created and then treated as revoked). Covered by OWN-AC-07.
- **2026-10-01 (Iteration 01.5) — Sign-in rate limit:** the per-client auth limit (20/min) is configurable through `AUTH_RATE_LIMIT_PER_MINUTE` (5–1000).
- **2026-10-01 (Iteration 02) — Wallet permissions in use:** the existing catalog is unchanged; Iteration 02 starts enforcing the wallet permissions.

  | Permission | Routes |
  | --- | --- |
  | `wallet.read` | Registry list and detail, indexed history, manual sync, transaction list and detail (SPEC-009, SPEC-004) |
  | `wallet.create` | Ownership challenges, registration, and metadata updates (SPEC-009) |
  | `wallet.export` | Recording an export of local wallet recovery material (SPEC-010) |
  | `wallet.control` | Preparing, signing, and submitting transactions from a managed wallet (SPEC-004), together with a `CREATOR` or `CONTROLLER` wallet assignment |
  | `organization.manage` | Wallet assignments and the organization member picker (SPEC-009) |

  `wallet.fund` stays reserved (funding flows are not part of Iteration 02). The generated authorization matrix (RBAC-AC-02) covers every new route.
