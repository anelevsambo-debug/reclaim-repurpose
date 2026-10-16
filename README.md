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

**Stage 1 complete** — Pure validation foundation (16 October 2026)

- Clean project skeleton
- Apps Script manifest
- Pure validation module + Node tests
- GitHub Actions CI

No live Google, WhatsApp, or operational capability is claimed.

---

*Build the smallest verifiable pilot. Prefer evidence over speculation.*
