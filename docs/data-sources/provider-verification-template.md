# Provider Verification Record — `<provider-id>`

Copy this template to `docs/data-sources/<provider-id>.md` before integrating a provider. A provider cannot move to `ADOPTED` in DATA_SOURCES.md until every item is checked. Do not build from search snippets alone.

| Field | Value |
| --- | --- |
| Provider | |
| Official documentation URL | |
| Base URL(s) | |
| Networks supported | |
| Capability / purpose in this product | |
| Verified by / date | |

## Checklist

- [ ] Official documentation inspected (not only third-party articles)
- [ ] Endpoint(s) verified and reachable
- [ ] Authentication method verified (none / API key header / API key query / OAuth)
- [ ] Free-tier availability verified for **the exact functionality needed**
- [ ] Rate limits verified (per second / per minute / per month / credits) and recorded
- [ ] Terms of use reviewed (commercial use, attribution, caching, redistribution)
- [ ] Response schema verified against real responses; Zod schema written
- [ ] Endpoint tested live; sample response captured as a test fixture (keys removed)
- [ ] Adapter created behind a domain port
- [ ] Validation, timeout, retry/backoff/jitter, concurrency limit, and rate limiter configured
- [ ] Caching policy defined (TTL, staleness threshold, provenance preserved)
- [ ] Health monitoring registered (probe method and interval within budget)
- [ ] Degradation behavior defined (`UNAVAILABLE` reason, fallback if same metric and network)
- [ ] DATA_SOURCES.md entry updated with "Last verified"
- [ ] changelog.md entry added

## Findings

### Limits

### Schema notes

### Reliability notes

### Legal / terms notes

### Decision

`ADOPTED` / `CANDIDATE` / `REJECTED` — reason:
