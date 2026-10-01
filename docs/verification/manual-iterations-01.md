# Manual Verification — Iterations 01 and 01.5

Owner-run browser verification that closes Iteration 01 (Foundation and Wallet Overview) and Iteration 01.5 (User Settings and Owner Console). Automated tests already cover every acceptance criterion; this guide checks the same criteria against a real third-party browser wallet and real Devnet data.

Mark each item `[x]` when it passes. When an item fails, write what you saw under it (screen, message, request id if shown) and leave it unchecked.

Criteria that can only be exercised by automated tests (WO-AC-08, 11, 12, 13, 17; SET-AC-05, 09) are not repeated here; see the test evidence in `checklist.md`.

---

## 0. Preparation

### 0.1 Wallets

- [ ] **Wallet A (owner):** a Wallet Standard browser wallet (Phantom, Solflare, or Backpack) with an account switched to **Devnet**.
- [ ] Wallet A has some Devnet SOL (https://faucet.solana.com) and, ideally, at least one SPL token account and one recent transaction, so WO-AC-03/04/05 show real rows.
- [ ] **Wallet B (admin, optional but needed for OWN-AC-01, 03–08):** a second account (another account in the same wallet extension, or a second browser profile). It must be a different address from Wallet A.
- [ ] **Empty address (optional):** a freshly generated Devnet address with no history, for WO-AC-09/10. Any new account in the wallet works; you only need its public address.

### 0.2 Environment (`.env` at the repository root)

| Variable | Value |
| --- | --- |
| `AUTH_SECRET` | output of `openssl rand -base64 32` |
| `BOOTSTRAP_OWNER_WALLET_ADDRESS` | public address of Wallet A |
| `DEFAULT_MEMBER_ROLE` | `admin` (gives Wallet B the admin role on first sign-in; leave empty after verification) |
| `SOLANA_CLUSTER` / `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` |

Only public addresses go in `.env`. Never paste a private key or seed phrase anywhere.

### 0.3 Start the stack

```sh
pnpm install
# Docker Desktop must be running
pnpm infra:up
pnpm db:migrate && pnpm db:seed   # re-run: Iteration 01.5 added tables and the platform.administer permission
pnpm dev                          # terminal :3000, API :4000, worker
```

- [ ] `pnpm dev` starts the terminal, API, and worker without configuration errors.
- [ ] http://localhost:3000 opens and the status bar shows `SOLANA DEVNET` (NET-AC-05).

**Bootstrap order matters:** sign in with Wallet A **before** Wallet B. The first sign-in of the bootstrap address grants `owner` only while the default organization has no owner.

---

## 1. Iteration 01 — Wallet Overview (SPEC-002)

### WO-AC-01 — Wallet detection
- [ ] With your wallet extension enabled, the top bar shows a `Connect <Wallet name>` button with the wallet's name (and icon in the wallet panel).
- [ ] In a browser profile without any Solana wallet, the terminal shows `No Devnet wallet detected.`

### WO-AC-02 — Connection and audit
- [ ] Connect Wallet A and choose **Sign in with this wallet**. The wallet asks you to sign a **text message** (never a transaction). Approve it.
- [ ] The overview shows Wallet A's public address and the network `SOLANA DEVNET`.
- [ ] Later, in **Settings → Owner console → Audit log** (section 2.3), filter by action `wallet.connected`: an event exists with the address, wallet name, chain, actor, organization, and request id.

### WO-AC-03 — Real SOL balance
- [ ] The `SOL balance` panel shows the balance with 9 decimals.
- [ ] Open the same address on https://explorer.solana.com/?cluster=devnet: the balance matches (allow for transactions made in between).

### WO-AC-04 — Token accounts
- [ ] The `Token accounts` panel lists each account with token account, mint, program (SPL Token or Token-2022), raw amount, decimals, display amount, and state.
- [ ] The list matches the explorer's "Tokens" tab for the address.

### WO-AC-05 — Recent transactions
- [ ] `Recent transactions` lists up to 20 signatures, newest first, with slot, block time (or `Unknown`), and success/failure status.
- [ ] Each explorer link opens the transaction on the Devnet explorer (the URL contains `cluster=devnet`).

### WO-AC-06 — Provenance
- [ ] Each available panel has a "Show data source for …" control. Opening it shows source, provider, RPC method, network, commitment, context slot, retrieved-at time, latency, and request id.

### WO-AC-07 — Freshness
- [ ] Each panel shows `Updated N s ago`.
- [ ] With auto-refresh turned **off** in Settings → Preferences, wait more than 60 s: the label changes to `Stale — last update … ago`. Turn auto-refresh back on afterward.

### WO-AC-09 / WO-AC-10 — Empty address
- [ ] In the address field (`Watch address`), enter the empty Devnet address. The token panel shows `No token accounts found for this wallet on Devnet.` with no placeholder rows.
- [ ] The transactions panel shows `No indexed transactions are available for this wallet.`

### WO-AC-14 — Disconnection and account switch
- [ ] Choose **Disconnect wallet**: Wallet A's data disappears immediately and the disconnected state is shown.
- [ ] Reconnect, then switch accounts inside the wallet extension: the previous address's data disappears immediately and the new account's state is shown.

### WO-AC-15 — Cluster mismatch
- [ ] Switch the wallet to **Mainnet** (or an account without Devnet) and connect. The terminal shows `This wallet account is not configured for Solana Devnet.` and does not offer sign-in for that account.
- [ ] Audit log contains `wallet.connection_rejected` with reason `CLUSTER_MISMATCH`.
- [ ] Switch the wallet back to Devnet.

### WO-AC-16 — Bounded refresh
- [ ] With DevTools → Network open and auto-refresh at 30 s, overview requests (`/api/v1/wallets/…/overview`) occur no more often than every 30 s.
- [ ] Switch to another tab for a minute: no overview requests are made while the tab is hidden.
- [ ] Pressing **Refresh** twice within 10 s returns the same `retrievedAt` in the provenance details (served from cache).

---

## 2. Iteration 01.5 — User Settings (SPEC-025)

### SET-AC-01 — Settings navigation
- [ ] Signed in, the primary navigation shows `Settings`; `/settings` opens **Profile**.
- [ ] Signed out (choose **Sign out**), `/settings` shows a sign-in prompt and no settings data. Sign in again.

### SET-AC-02 — Profile
- [ ] Profile shows display name, sign-in wallets (address, cluster, first and last seen), organization, roles (`owner` for Wallet A), and effective permissions.

### SET-AC-03 — Display name
- [ ] Save a display name: an inline `Saved` status appears and the status bar shows the new name.
- [ ] Reload the page: the name persists. Clear it and save: the status bar falls back to the short wallet address.
- [ ] An only-spaces name or a name longer than 64 characters is rejected with `Invalid display name`.
- [ ] Audit log contains `user.profile_updated`.

### SET-AC-04 — Preferences persistence
- [ ] Change several preferences and choose **Save preferences**. Reload: they persist.
- [ ] Sign in with the same wallet in another browser (or private window): the same preferences apply.

### SET-AC-06 — Preferences are applied
- [ ] **Time zone:** switching between the browser time zone and UTC changes block times and session times, always with the zone label.
- [ ] **Density:** `Compact` vs `Comfortable` changes row spacing and text size.
- [ ] **Reduce motion:** when on, transitions and animations stop.
- [ ] **Block explorer:** Solana Explorer vs Solscan changes transaction links; both keep the Devnet cluster parameter.
- [ ] **Wallet Overview auto-refresh:** 30 s / `Every minute` / `Every 2 minutes` / off changes the refresh cadence (check in DevTools); off stops automatic requests.
- [ ] **Keyboard shortcuts:** when on, `/` focuses the address field and `R` refreshes; when off, both keys do nothing.
- [ ] **Addresses and signatures:** short vs `Full` changes how addresses render.

### SET-AC-07 — Own sessions
- [ ] With Wallet A signed in on two browsers, **Settings → Sessions** lists both, with created, last activity, expiry, IP address, user agent, and sign-in wallet; the current one is marked.
- [ ] Sessions of Wallet B never appear here.

### SET-AC-08 — Revoke sessions
- [ ] Revoke the other browser's session (`That device is signed out.`): the other browser is signed out on its next request.
- [ ] Sign in again on the other browser, then choose **Sign out other sessions** / **Sign out everywhere else**: only the current session remains.
- [ ] The current session has no revoke action (revoking it is refused).
- [ ] Audit log contains `session.revoked` for each revocation.

---

## 3. Iteration 01.5 — Owner Console (SPEC-026)

Sign in with Wallet B once (it receives `admin` through `DEFAULT_MEMBER_ROLE`), then return to Wallet A (owner) unless an item says otherwise.

### OWN-AC-01 — Owner-only access
- [ ] As **Wallet B (admin)**: Settings shows no `Owner console` group, and opening `/settings/console/overview` directly shows `The owner console is available to the organization owner only.`
- [ ] As **Wallet A (owner)**: every console page opens (Overview, Members, Sessions, Audit log, Organization, Announcement, System, Jobs, Developer).
- [ ] As **Wallet B**, in DevTools → Console on http://localhost:3000, run `fetch("/api/v1/admin/overview").then(r => r.status)`: it returns `403`. (The console page hides itself in the browser; this checks the API enforcement.)
- [ ] As Wallet A, the Audit log contains an `authorization.denied` event for Wallet B's request.

### OWN-AC-02 — Overview
- [ ] Shows user, member, active-session, and 24-hour audit counts (2 users, 2 members after Wallet B's sign-in), readiness, cluster verification, provider status, and the last worker probe time.

### OWN-AC-03 — Members
- [ ] Each user shows wallet identities, account status, membership status and roles, active session count, and last activity.

### OWN-AC-04 — Set role
- [ ] On Wallet B, **Set role** to `viewer` and **Apply role**. As Wallet B, the next action reflects the new permissions (e.g. Profile lists only viewer permissions).
- [ ] Audit log contains `role.revoked` (admin) and `role.assigned` (viewer).
- [ ] Set Wallet B back to `admin`.

### OWN-AC-05 — Protected accounts
- [ ] Your own row (Wallet A) offers no role, membership, account, or session actions and states `This is your account. Manage your own access from Profile and Sessions.`
- [ ] The role selector does not offer `owner`.

### OWN-AC-06 — Suspend and reactivate membership
- [ ] **Suspend membership** for Wallet B (confirm). As Wallet B, wallet data and permissioned pages return "no permission" states.
- [ ] Reactivate: Wallet B's access returns. Audit log contains `member.suspended` and `member.reactivated`.

### OWN-AC-07 — Disable and enable account
- [ ] **Disable account** for Wallet B (confirm). Wallet B is signed out on its next request and a new sign-in is refused (account disabled).
- [ ] Enable the account: Wallet B can sign in again. Audit log contains `user.disabled` and `user.enabled`.

### OWN-AC-08 — Platform sessions
- [ ] **Owner console → Sessions** lists active sessions of all users with user, wallet, IP address, user agent, and times.
- [ ] Revoke one of Wallet B's sessions: Wallet B is signed out. Your own current session cannot be revoked here.

### OWN-AC-09 — Audit log
- [ ] Events appear newest first; your own sign-in events are present.
- [ ] Filtering by action, actor user ID, resource type, and time range narrows the results; **Load older events** pages back.
- [ ] Event metadata renders as plain text.

### OWN-AC-10 — Organization
- [ ] **Rename organization** to a new name: it changes everywhere it is displayed (Profile, status bar).
- [ ] An empty name or one longer than 100 characters is rejected (`Invalid name`).
- [ ] The role and permission matrix is shown (`owner` holds `platform.administer`; `admin` does not).
- [ ] Audit log contains `organization.updated` with the previous and new name.

### OWN-AC-11 — Announcement
- [ ] Write a message, choose a severity (`NOTICE`, `WARNING`, `CRITICAL`), enable **Show to all users**, and **Publish announcement**. The preview matches.
- [ ] As Wallet B, the banner appears below the status bar as plain text with the severity label and color. Markup such as `<b>x</b>` is shown literally, not rendered.
- [ ] Disable it: the banner disappears for both users. Audit log contains `announcement.updated`.

### OWN-AC-12 — System (runtime without secrets)
- [ ] Shows environment, cluster, a **redacted** RPC endpoint, session timeouts, bootstrap and default-role settings, API process facts, PostgreSQL facts (version, size, applied vs. committed migrations, table statistics, latency), and Redis facts.
- [ ] No secret appears anywhere on the page (no `AUTH_SECRET`, passwords, or full connection strings).

### OWN-AC-13 — Cluster re-verification
- [ ] **Verify now** returns the observed genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (Devnet) as verified.
- [ ] Audit log contains `system.cluster_verification_requested`.

### OWN-AC-14 — Provider history
- [ ] With the worker running for a few minutes, `Provider health snapshots` lists entries newest first with status, latency, error rate, request count, and failure reason.

### OWN-AC-15 — Jobs
- [ ] Shows queue counts, the provider-health scheduler (interval and next run), and recent completed and failed jobs.
- [ ] **Run probe now** returns a job id; a new completed job appears shortly. Audit log contains `system.job_enqueued`.

### OWN-AC-16 — Developer
- [ ] `API routes` lists every route with method, path, and access requirement (`public`, `session`, or the permission).
- [ ] The OpenAPI link is shown (non-production) and opens.
- [ ] **Purge** the Wallet Overview cache: it reports the number of keys removed; the next overview load hits the RPC again (new `retrievedAt`). Audit log contains `system.cache_purged`.

---

## 4. Sign-off

| Iteration | Result | Date | Notes |
| --- | --- | --- | --- |
| 01 — Foundation and Wallet Overview | | | |
| 01.5 — User Settings and Owner Console | | | |

After verification, clear `DEFAULT_MEMBER_ROLE` in `.env` and report any unchecked item so it can be fixed and the iterations marked `COMPLETE` in `checklist.md`.
