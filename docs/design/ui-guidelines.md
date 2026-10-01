# UI Guidelines

Status: Baseline (Iteration 00). Implemented as design tokens and primitives in `packages/ui` during Iteration 01.

The visual language is a **professional corporate financial terminal**: dense, calm, precise. Not a crypto casino, meme dashboard, neon cyberpunk, gaming UI, SaaS landing page, or dashboard template.

Every important element must answer: *what real system capability does this represent?* If the answer is unclear, do not build it.

## 1. Color

Dark mode by default; grayscale first. Color only communicates financial or operational meaning.

| Token | Purpose | Suggested value |
| --- | --- | --- |
| `--bg` | Application background | `#0a0a0a` |
| `--surface-1` | Panels | `#111111` |
| `--surface-2` | Raised rows, headers, inputs | `#181818` |
| `--border` | Panel and table borders | `#2a2a2a` |
| `--border-strong` | Focus-adjacent separators | `#3a3a3a` |
| `--text-primary` | Primary text | `#f2f2f2` |
| `--text-secondary` | Secondary text | `#a3a3a3` |
| `--text-muted` | Muted labels | `#8a8a8a` (raised from `#6b6b6b` in Iteration 01 to meet 4.5:1 contrast on panels) |
| `--positive` | Gains, success, confirmed | `#3fb950` |
| `--negative` | Losses, failures | `#f85149` |
| `--warning` | Stale data, degraded providers | `#d29922` |
| `--critical` | Blocking conditions (cluster mismatch, unverified RPC) | `#ff6b6b` on `#2a0f0f` |
| `--active` | Focus ring, selection | `#58a6ff` |
| `--network-devnet` | Network indicator | `#c9a227` text on `#1f1a08` |

All text/background pairs meet WCAG 2.2 AA contrast (4.5:1 for body text, 3:1 for large text and UI components). Final values are verified with an automated contrast check.

Never: gradients as decoration, glow/neon effects, glassmorphism, animated backgrounds, decorative particles.

## 2. Typography

- UI text: a highly legible sans-serif (e.g. Inter or IBM Plex Sans), 13 px base in dense tables, 14 px in forms.
- Numbers, addresses, signatures, amounts: monospace (e.g. JetBrains Mono or IBM Plex Mono) with `font-variant-numeric: tabular-nums`.
- Addresses: show middle-truncated (`7xKX…9fQa`) with full value on hover/focus, copy action, and explorer link. Never truncate in confirmation screens — show the full address there.
- Amounts: right-aligned in tables; exact decimals; units always shown (`SOL`, raw token units, or symbol once metadata is verified).

## 3. Layout and density

- Persistent left navigation by domain; top status bar with: network indicator (`SOLANA DEVNET`), cluster verification status, provider health indicator, session/organization, command palette hint (`Ctrl/Cmd + K`, Iteration 02+).
- Panels with 1 px borders and small radii (≤ 4 px). No giant rounded cards, no excessive pills, restrained shadows (none by default).
- Tables are the primary data surface: compact rows (28–32 px), sortable columns, sticky headers, filters, keyboard row navigation.
- Resizable split panels for list/detail views (Iteration 02+).
- No hero sections; minimal whitespace in data-heavy areas.

## 4. Required states for every data view

| State | Pattern |
| --- | --- |
| Loading | Skeleton rows matching the final layout + text naming the current operation ("Fetching token accounts from Devnet RPC…"). No endless generic spinners. |
| Empty | Plain explanation and the next action ("No wallets found. Create or connect a wallet to begin."). |
| Error | What failed, why (classified reason), what the user can do, request id for support. |
| Unavailable | `DATA UNAVAILABLE` block (SPEC-003): reason, source, last successful retrieval, retry state, Retry action. |
| Stale | Warning-colored freshness label: "Stale — last update 4m 17s ago". |
| Fresh | Muted freshness label: "Updated 12 s ago"; exact timestamp on hover/focus. |
| Long-running job | Job state, progress when known, started time, last update. |

## 5. Charts

Only real data. Every chart shows timeframe, data source, timestamp context, and has loading, empty, and error states. No decorative or placeholder charts.

## 6. Sensitive operations

- Confirmation dialogs show all material transaction information (SECURITY.md §3) in readable text; nothing hidden behind animation.
- Destructive or signing actions require an explicit, clearly labeled button ("Sign and submit on Devnet"), never a default-focused action.
- Mobile keeps sensitive flows fully readable; no truncation of addresses in confirmations.

## 7. Copy

- American English; plain and precise.
- Financially neutral: prefer "Observed", "Potential concern", "Historical pattern", "Insufficient data", "High uncertainty". Never "Buy now", "Guaranteed", "100x", "Safe", "Certain".
- Errors are actionable and never blame the user.

## 8. Accessibility

- Semantic HTML (tables for tabular data, headings hierarchy, landmarks).
- Full keyboard navigation; visible focus ring (`--active`, 2 px).
- Radix-based primitives for dialogs, menus, popovers, tooltips (focus trapping, ARIA).
- Screen-reader labels for icon-only controls, truncated addresses (full address in `aria-label`), and status indicators (not color alone — always text or icon + text).
- `prefers-reduced-motion` respected; motion is functional only.
- Automated axe checks in E2E; manual keyboard pass per iteration.

## 9. Responsive behavior

- Desktop (≥ 1280 px): primary terminal experience, multi-panel.
- Tablet (768–1279 px): collapsible navigation, single detail panel.
- Mobile (< 768 px): tables transform into labeled row cards with the most important columns; the network indicator stays visible; critical actions remain reachable. Do not merely shrink the desktop UI.
