# RECLAIM & REPURPOSE

**Southern African circular-economy pilot**  
Botswana · Eswatini

WhatsApp-first · Google Apps Script + Google Sheets · AppSheet dashboards · Evidence-led

---

## Project purpose

RECLAIM & REPURPOSE helps communities and organisations recover useful materials, reduce avoidable waste, and measure environmental and economic outcomes.

The product begins with a small, verifiable pilot and scales only when site permissions, operating procedures, customer need, and recovery-partner acceptance are supported by evidence.

## Geography & currency rules

| Country     | Currency | Rule |
|-------------|----------|------|
| Botswana    | BWP      | Country-specific. Never combine with SZL. |
| Eswatini    | SZL      | Country-specific. Never combine with BWP. |

All financial figures, assumptions, and reports must remain country-scoped.

## Locked digital architecture

| Layer                      | Technology                          | Status / Notes |
|----------------------------|-------------------------------------|----------------|
| Participant channel        | WhatsApp                            | Provider-independent workflow first; provider-specific authentication later |
| Backend & persistence      | Google Apps Script + Google Sheets  | Server-side validation, identity, authorisation, audit, idempotency |
| Admin / company dashboards | AppSheet                            | After backend security boundary is proven. View filters are **not** a security boundary. |
| Code & validation          | GitHub                              | Source of truth for code, tests, and evidence manifests |

### Explicit exclusions (hard constraints)

- No standalone custom web application (React / Node / Python / PHP dashboard or separate backend)
- No alternate database outside Google Sheets for the pilot
- No blockchain, smart contracts, or crypto
- No payments platform in scope for the initial product
- Do not import requirements from other projects (e.g. FIKISHA)

## Operating integrity rules

1. **Collection is not recycling.**  
   Material that has been collected is not automatically sorted, accepted, reused, or recycled. Each downstream state requires its own event and evidence.

2. **Evidence before claims.**  
   No invented customers, partners, collection volumes, recycling results, or impact numbers. Synthetic tests do not prove live integration.

3. **Fail-closed by default.**  
   Missing identity, missing authorisation, schema mismatch, or ambiguous recovery state must refuse the operation rather than guess.

4. **Safety and legal gates first.**  
   Do not begin physical collection, sorting, storage, transport, or handover until applicable safety, site, legal, customer, and receiving-partner requirements are evidenced for the specific country and site.

## Current status

**Stage 1 complete; Stage 2 real identity integration remains incomplete; Stage 3 implementation is under review** (17 October 2026)

Implemented and CI-verified:

- Clean project skeleton and Apps Script V8 manifest
- Pure validation module and Node test suite
- Country policy returned as detached data; internal country rules are not exported for mutation
- Pure company authorization policy with active-membership, identity-match, role, action, and tenant-scope checks
- Negative tests for unauthenticated identities, unsupported roles/actions, inactive membership, and cross-company access
- Apps Script manifest least-privilege check; unused explicit OAuth scopes removed until integrations require them
- GitHub Actions validation workflow
- Stage 3 pull request #5 adds a versioned schema contract and dependency-injected Google Sheets repository, with synthetic tests for company scoping, locking, and retry recovery

**Not implemented or proven:** verified WhatsApp webhook identity, Google identity integration, a configured live workbook, real Apps Script/Google Sheets integration tests, AppSheet dashboards, live deployment, or operational pilot capability. Stage 3 is not complete until pull request #5 is reviewed, CI is verified, and the remaining trust-boundary limitations are documented and accepted.

The authorization helper is not an authentication system. It must only receive a principal from a future verified identity adapter and membership loaded from the server-side store. Do not accept these values directly from customer-controlled request fields.

**Current engineering focus:** review Stage 3 pull request #5, verify automated tests, and keep all live integration gates blocked. Stage 2 verified identity integration and authoritative membership provenance must be implemented before any public registration entry point can be enabled.

---

*Build the smallest verifiable pilot. Prefer evidence over speculation.*
