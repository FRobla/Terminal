# SPEC-026 — Owner Console

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 01.5 |
| Domain(s) | `organizations`, `users`, `auth` (sessions), `audit`, `announcements`, `system`, `developer`; terminal `console` |
| Criteria prefix | `OWN` |
| Related | SPEC-007 (RBAC), SPEC-008 (audit), SPEC-006 (provider health), SPEC-005, SPEC-025 |

## 1. Problem and goal

The platform owner needs a single administrative and developer terminal inside Settings to operate every aspect of the platform that exists today: people and access, sessions, the audit trail, the organization, platform-wide announcements, runtime and infrastructure state, background jobs, and developer tooling. Everything shown is real, read live from PostgreSQL, Redis, BullMQ, the API process, or the Solana RPC; nothing is simulated.

Owner request, 2026-10-01. This brings forward part of Iteration 08 (membership management, audit viewer) for the owner only; teams, invitations, custom roles, and API credentials remain in Iteration 08.

## 2. Scope

In scope (owner only):
- **Overview:** users, members, active sessions, audit outcomes in the last 24 h, readiness, cluster verification, provider status, last worker probe.
- **Members:** every user on the platform with wallet identities, account status, membership and roles in the active organization, active sessions, last activity. Actions: set role, suspend/reactivate membership, disable/enable account, revoke all sessions.
- **Sessions:** every active session on the platform; revoke any session except the caller's current one.
- **Audit log:** the existing audit endpoint with filters (action, result-agnostic, actor, resource type, time range) and cursor pagination.
- **Organization:** name (editable), slug, member counts by role; role and permission matrix from the database.
- **Announcement:** a platform-wide banner (enabled, severity, message) shown to every signed-in user.
- **System:** non-secret runtime configuration, API process facts, PostgreSQL (version, size, migrations, table statistics, latency), Redis (version, memory, clients, keys, latency), cluster identity with on-demand re-verification, provider health history.
- **Jobs:** BullMQ queue counts, schedulers, recent completed and failed jobs; run the provider health probe on demand.
- **Developer:** live route catalog with each route's access requirement, OpenAPI document link (non-production), cache purge (Wallet Overview cache, permission cache).

Out of scope:
- Granting or revoking the `owner` role, ownership transfer, custom roles, teams, invitations, API credentials (Iteration 08).
- Editing environment configuration or secrets at runtime (configuration stays in the environment; ADR-0006, OPERATIONS.md).
- Deleting users, memberships, sessions, or audit records (all actions are reversible state changes).
- Enabling or disabling the only RPC provider.

## 3. Domain concepts

- **Permission `platform.administer`** — "Operate the owner console: platform administration and developer tooling". Held only by the `owner` system role. The `admin` role holds every other permission (SPEC-007 amendment 2026-10-01).
- **Protected account** — the caller themself, or any user holding the `owner` role in the active organization. Role, membership, account-status, and revoke-all-sessions actions on a protected account are refused with `OPERATION_NOT_ALLOWED` and a `details.reason` of `SELF` or `OWNER_PROTECTED`.
- **Assignable roles** — system roles except `owner`. Setting a role replaces the member's existing roles with exactly one role (creating an active membership in the active organization when none exists).
- **Announcement** — `{ enabled, severity: info | warning | critical, message (1–500 characters, no control characters), updatedAt, updatedBy }`, stored as versioned platform configuration.
- **Runtime configuration view** — an allowlist of non-secret settings. Secrets (`AUTH_SECRET`, `ENCRYPTION_KEY`, database and Redis URLs, API keys) are never returned; the RPC endpoint is returned redacted (PRV-AC-05).

## 4. Behavior

```
Terminal /settings/console/* → /api/v1/admin/* (permission platform.administer)
  → application services (member administration, session administration, organization,
    announcements, runtime inspection, job inspection, developer tooling)
  → PostgreSQL · Redis · BullMQ · API process · Solana RPC (cluster re-verification, probe job)
  → audit event for every state change
```

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/overview` | Platform counters and status |
| GET | `/admin/users` | Users with identities, membership, roles, sessions (cursor pagination) |
| PUT | `/admin/users/{userId}/role` | Set the member's single role `{ roleKey }` |
| PUT | `/admin/users/{userId}/membership` | `{ status: active \| suspended }` |
| PUT | `/admin/users/{userId}/status` | `{ status: active \| disabled }`; disabling also revokes sessions |
| POST | `/admin/users/{userId}/sessions/revoke` | Revoke all of the user's sessions |
| GET | `/admin/sessions` | Active sessions platform-wide |
| POST | `/admin/sessions/{sessionId}/revoke` | Revoke one session |
| GET | `/admin/organization` | Organization and member counts |
| PATCH | `/admin/organization` | `{ name }` |
| GET | `/admin/roles` | Roles, permissions, member counts |
| PUT | `/admin/announcement` | Set the announcement |
| GET | `/announcements/current` | (session) Current announcement for every signed-in user |
| GET | `/admin/system/runtime` | Configuration, process, PostgreSQL, Redis |
| POST | `/admin/system/cluster/verify` | Re-verify the cluster now |
| GET | `/admin/system/provider-history` | Provider health snapshots |
| GET | `/admin/jobs` | Queue state |
| POST | `/admin/jobs/provider-health/run` | Enqueue one provider health probe |
| GET | `/admin/developer/routes` | Route catalog |
| POST | `/admin/developer/cache/purge` | `{ target: wallet-overview \| permissions }` |

After any role, membership, or account-status change, the API drops its permission cache so the change takes effect on the next request in this process (other API processes within the ≤ 60 s cache TTL, SPEC-007 §7).

## 5. External data dependencies

| Data | Source | Network | Budget impact | Failure behavior |
| --- | --- | --- | --- | --- |
| Cluster re-verification | Solana RPC `getGenesisHash`, `getVersion` | Devnet | 2 requests per click; route limited to 6/min | Identity shows the failure reason |
| Provider probe (job) | Worker → Solana RPC `getSlot` | Devnet | 1–2 requests per run; route limited to 6/min | Job appears as failed with its reason |
| Database / Redis facts | PostgreSQL catalogs, Redis `INFO` | — | Local | Section shows `DATA UNAVAILABLE` with the reason |

## 6. Security considerations

- Every `/admin/*` route declares `{ permission: "platform.administer" }`; denials are audited (`authorization.denied`). The terminal hides the console for other users, but the API is the enforcement point.
- No secrets in responses: allowlisted configuration only, redacted RPC endpoint, no session token hashes, no CSRF tokens.
- Destructive-looking actions (disable account, revoke sessions, suspend) require an explicit confirmation step in the UI and are reversible.
- The announcement message is owner-supplied text: validated, stored, and rendered as plain text.
- Audit events: `role.assigned`, `role.revoked`, `member.suspended`, `member.reactivated`, `user.disabled`, `user.enabled`, `session.revoked`, `organization.updated`, `announcement.updated`, `system.cluster_verification_requested`, `system.job_enqueued`, `system.cache_purged`.
- Rate limits: the global API limit applies; cluster re-verification and the probe job are limited to 6 requests per minute per client.

## 7. States

| State | Trigger | UI representation |
| --- | --- | --- |
| Not permitted | Session lacks `platform.administer` | "The owner console is available to the organization owner only." No console navigation. |
| Loading | Request in flight | Skeleton with the operation text |
| Empty | No rows (e.g. no failed jobs) | A sentence stating what is true |
| Error | API error | Error state with message and request id |
| Unavailable | A dependency (PostgreSQL catalog, Redis, queue) cannot be read | `DATA UNAVAILABLE` with reason and source |
| Confirming | Sensitive action selected | Inline confirmation with the consequence stated |

## 8. Acceptance criteria

### OWN-AC-01 — Owner-only access
Given a session holding every permission except `platform.administer` (e.g. `admin`)
When any `/admin/*` route is called
Then it returns `403 FORBIDDEN`, the denial is audited, and the terminal shows no console navigation; given the `owner`, every route succeeds.

### OWN-AC-02 — Overview
Given the owner
When they open the Overview
Then user, member, active-session, and 24-hour audit counts match the database, and readiness, cluster verification, provider status, and the last worker probe time are shown.

### OWN-AC-03 — Members list
Given users with and without memberships
When the owner lists users
Then each user shows wallet identities, account status, membership status and roles in the active organization (or none), active session count, and last activity, paginated by cursor.

### OWN-AC-04 — Set role
Given a non-protected user
When the owner sets an assignable role
Then the user holds exactly that role in the active organization (membership created or reactivated as needed), `role.revoked` is audited for each removed role and `role.assigned` for the new one, and the user's next request uses the new permissions.

### OWN-AC-05 — Protected accounts
Given the owner themself or another owner
When a role, membership, account-status, or revoke-all-sessions action targets them, or the `owner` role is requested
Then the API refuses with `OPERATION_NOT_ALLOWED` (`details.reason` `SELF` or `OWNER_PROTECTED`) or `VALIDATION_FAILED` for the `owner` role, and nothing changes.

### OWN-AC-06 — Suspend and reactivate membership
Given a member
When the owner suspends the membership
Then the member's next request has no organization permissions (`403`), `member.suspended` is audited, and reactivation restores access and audits `member.reactivated`.

### OWN-AC-07 — Disable and enable account
Given a user
When the owner disables the account
Then all of the user's sessions stop authenticating, new sign-ins cannot use it, `user.disabled` is audited, and enabling it audits `user.enabled` and allows sign-in again.

### OWN-AC-08 — Session administration
Given active sessions on the platform
When the owner lists them and revokes one (or all of a user's)
Then only active sessions are listed with user, wallet, IP address, user agent, and times; revoked sessions stop authenticating; `session.revoked` is audited; the owner's current session cannot be revoked here (`OPERATION_NOT_ALLOWED`).

### OWN-AC-09 — Audit log viewer
Given audit events
When the owner filters by action, actor, resource type, or time range and pages through results
Then events are shown newest first from `/audit/events`, scoped to the active organization, with metadata rendered as text.

### OWN-AC-10 — Organization
Given the owner
When they rename the organization (1–100 characters, no control characters)
Then the name changes everywhere it is displayed and `organization.updated` is audited with the previous and new name; the role and permission matrix shown matches the database.

### OWN-AC-11 — Announcement
Given the owner saves an enabled announcement
When any signed-in user loads the terminal
Then a banner shows the message as plain text with its severity (text and color); disabling it removes the banner; `announcement.updated` is audited; invalid messages are rejected.

### OWN-AC-12 — Runtime inspection without secrets
Given the owner
When they open System
Then they see the allowlisted configuration (environment, cluster, redacted RPC endpoint, session timeouts, bootstrap and default-role settings), API process facts, PostgreSQL facts (version, size, applied vs. committed migrations, table statistics, latency), and Redis facts (version, memory, clients, keys, latency); the response contains no secret, credential, or unredacted endpoint; an unreadable dependency is shown as unavailable with a reason.

### OWN-AC-13 — Cluster re-verification
Given the owner
When they request re-verification
Then the API checks the genesis hash against the RPC immediately, returns the resulting identity, and audits `system.cluster_verification_requested` with the outcome.

### OWN-AC-14 — Provider history
Given worker health snapshots
When the owner opens provider history
Then snapshots are listed newest first with status, latency, error rate, request count, and failure reason.

### OWN-AC-15 — Jobs
Given the BullMQ provider-health queue
When the owner opens Jobs
Then queue counts, schedulers (interval and next run), and recent completed and failed jobs (with failure reasons) are shown; running the probe enqueues one job, audits `system.job_enqueued`, and returns its id.

### OWN-AC-16 — Developer tools
Given the owner
When they open Developer
Then the route catalog lists every registered route with method, path, and access requirement (`public`, `session`, or the permission), the OpenAPI link is shown outside production, and purging the Wallet Overview or permission cache deletes only that cache and audits `system.cache_purged` with the number of keys removed.

## 9. Test plan

| Criterion | Test layer | Notes |
| --- | --- | --- |
| OWN-AC-01 | Integration (every admin route × admin/owner) + RBAC matrix + E2E (navigation) | |
| OWN-AC-02, 03 | Integration | Counts compared with SQL |
| OWN-AC-04 … 08 | Unit (protection rules) + integration (state, audit, access effect) | |
| OWN-AC-09 | E2E | Audit page lists the owner's login |
| OWN-AC-10, 11 | Integration + E2E (banner) | |
| OWN-AC-12 | Integration (secret scan of the response) | |
| OWN-AC-13 | Integration (stub RPC) | |
| OWN-AC-14 | Integration | Snapshots inserted by the test |
| OWN-AC-15 | Integration (real BullMQ queue on the test Redis) | |
| OWN-AC-16 | Integration | |

## 10. Open questions

None blocking. Ownership transfer and multiple owners are deferred to Iteration 08.

## Amendments

_None._
