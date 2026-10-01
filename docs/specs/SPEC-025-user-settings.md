# SPEC-025 — User Settings

| Field | Value |
| --- | --- |
| Status | IMPLEMENTED |
| Iteration | 01.5 |
| Domain(s) | `users`, `auth` (sessions), terminal `settings`, `preferences` |
| Criteria prefix | `SET` |
| Related | SPEC-002 (WO-AC-16), SPEC-005 (NET-AC-07), SPEC-007, SPEC-008, SPEC-026 |

## 1. Problem and goal

Every signed-in user needs one place to manage their own profile, tune how the terminal behaves for them, and control where they are signed in. Settings are stored server-side so they follow the user across browsers and devices. Every preference must change real behavior; no setting is decorative.

Owner request, 2026-10-01.

## 2. Scope

In scope:
- **Profile:** display name (editable), sign-in wallet identities, organization, roles, and effective permissions (read-only).
- **Preferences** (per user, server-side): timestamp time zone, table density, reduced motion, block explorer, Wallet Overview auto-refresh interval, keyboard shortcuts, address display.
- **Sessions:** list of the user's own active sessions; revoke one other session or all other sessions.
- A `Settings` entry in the primary navigation for every signed-in user.

Out of scope:
- Changing the sign-in wallet, linking additional wallets, email/OIDC identities (Iteration 08).
- Organization switching (Iteration 08).
- Notification preferences (Iteration 07).

## 3. Domain concepts

- **Display name:** optional, 1–64 characters after trimming; control, format (including bidirectional overrides), and line-separator characters are rejected. `null` clears it. Rendered as plain text only.
- **Preferences v1** (`schemaVersion: 1`), with defaults:

| Key | Values | Default | Effect |
| --- | --- | --- | --- |
| `timeZone` | `local` · `utc` | `local` | All absolute timestamps (block times, provenance, last success, sessions, console tables) render in the browser's zone or UTC, always with the zone label. |
| `density` | `compact` · `comfortable` | `compact` | Table row spacing and base font size. |
| `reduceMotion` | boolean | `false` | Disables skeleton pulses and transitions (in addition to the OS setting). |
| `explorer` | `solana-explorer` · `solscan` | `solana-explorer` | Target of every address/signature link; links always carry the cluster (NET-AC-07). |
| `overviewRefreshSeconds` | `0` (off) · `30` · `60` · `120` | `30` | Wallet Overview auto-refresh. Never faster than 30 s (WO-AC-16). |
| `keyboardShortcuts` | boolean | `true` | Enables the `/` and `R` shortcuts. |
| `addressDisplay` | `short` · `full` | `short` | Middle-truncated or full addresses and signatures in tables. |

- Stored preferences are parsed with the current schema; unknown keys are dropped and missing or invalid keys fall back to defaults, so a schema evolution never breaks a user's terminal.
- **Active session:** not revoked, absolute expiry in the future, and last activity within the idle timeout.

## 4. Behavior

```
Terminal /settings/* → GET/PATCH/PUT /api/v1/me/* (session) → users / auth application services
  → PostgreSQL (users, user_preferences, sessions) → audit (profile and session changes)
```

1. `GET /me/profile` returns the user, wallet identities, active organization, role keys, and permissions.
2. `PATCH /me/profile { displayName }` validates, persists, invalidates the permission/session cache entry, and audits `user.profile_updated`.
3. `GET /me/preferences` returns the effective preferences (stored values merged over defaults). `PUT /me/preferences` replaces them with a complete, valid object (unknown keys rejected). Preferences are not sensitive and are not audited.
4. `GET /me/sessions` lists active sessions with `current: true` on the calling session. `POST /me/sessions/{id}/revoke` revokes one of the caller's other sessions; `POST /me/sessions/revoke-others` revokes all others. The current session cannot be revoked here (sign out instead). Each revocation is audited as `session.revoked`.
5. The terminal loads preferences after sign-in and applies them globally; while signed out, or while loading, defaults apply.

## 5. External data dependencies

None. Preferences change presentation only; they never alter data, provenance, or freshness thresholds.

## 6. Security considerations

- All `/me/*` routes require a session (`{ session: true }`) and act only on the caller's own records; ids from the path are checked against the session's user (another user's session id returns `404 NOT_FOUND`, revealing nothing).
- State-changing routes require CSRF token and origin (AUTH-AC-06).
- Display names are user-supplied text: validated server-side, rendered as text.
- Session listings show the caller's own IP addresses and user agents only.
- Audit: `user.profile_updated` (`fields`), `session.revoked` (`targetUserId`, `scope`, `reason`).

## 7. States

| State | Trigger | UI representation |
| --- | --- | --- |
| Signed out | No session | "Sign in to manage your settings." |
| Loading | Request in flight | Skeleton with the operation text |
| Saving | Mutation in flight | Button shows "Saving…", inputs disabled |
| Saved | Mutation succeeded | Inline "Saved" status (polite live region) |
| Error | API error | Error state with message and request id |
| Empty | No other sessions | "This is your only active session." |

## 8. Acceptance criteria

### SET-AC-01 — Settings navigation
Given a signed-in user (with or without organization membership)
When the terminal renders
Then the primary navigation shows `Settings`, and `/settings` opens the Profile section; signed-out users see a sign-in prompt instead of settings data.

### SET-AC-02 — Profile view
Given a signed-in user
When they open Profile
Then they see their display name, sign-in wallet identities (address, cluster, first and last seen), active organization, roles, and effective permissions, all from the API.

### SET-AC-03 — Display name update
Given a signed-in user
When they save a valid display name (or clear it)
Then it is persisted, returned by `/auth/session` and `/me/profile`, and `user.profile_updated` is audited; names that are empty after trimming, longer than 64 characters, or contain control/format characters are rejected with `VALIDATION_FAILED`.

### SET-AC-04 — Preferences persistence
Given a signed-in user
When they save preferences
Then `PUT /me/preferences` stores them for that user only, `GET /me/preferences` returns them on any device, unknown keys are rejected, and a user without stored preferences receives the defaults.

### SET-AC-05 — Stored preference tolerance
Given stored preferences containing unknown keys or invalid values (e.g. after a schema change)
When they are read
Then unknown keys are dropped and invalid values fall back to their defaults.

### SET-AC-06 — Preferences are applied
Given saved preferences
When the user uses the terminal
Then: timestamps render in the selected zone with its label; density and reduced motion are applied to the document; explorer links target the selected explorer with the cluster parameter; the Wallet Overview refreshes at the selected interval (never under 30 s, or not at all when off); `/` and `R` do nothing when shortcuts are disabled; addresses render short or full as selected.

### SET-AC-07 — Own sessions
Given a user with several active sessions
When they open Sessions
Then they see only their own active sessions (created, last activity, expiry, IP address, user agent, sign-in wallet) with the current one marked, and expired or revoked sessions are not listed.

### SET-AC-08 — Revoke sessions
Given a user with other active sessions
When they revoke one session or all other sessions
Then those sessions stop authenticating immediately, the current session remains valid, each revocation is audited as `session.revoked`, revoking the current session is refused with `OPERATION_NOT_ALLOWED`, and revoking another user's session returns `404 NOT_FOUND`.

### SET-AC-09 — Authorization
Given no session
When any `/me/*` route is called
Then it returns `401 UNAUTHENTICATED`; state-changing `/me/*` routes without a valid CSRF token return `403 CSRF_TOKEN_INVALID`.

## 9. Test plan

| Criterion | Test layer | Notes |
| --- | --- | --- |
| SET-AC-01 | E2E | Navigation for a member without permissions and for a signed-out visitor |
| SET-AC-02, 03 | Integration + unit (display-name rules) + E2E | |
| SET-AC-04, 05 | Unit (schema) + integration | |
| SET-AC-06 | Unit (timestamp formatting, explorer URLs, refresh interval) + E2E (density, explorer, shortcuts) | |
| SET-AC-07, 08 | Integration | Multiple sign-ins of the same wallet |
| SET-AC-09 | Integration | |

## 10. Open questions

None.

## Amendments

_None._
