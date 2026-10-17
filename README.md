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

**Stage 1 complete; Stage 3 foundation merged; Stage 2 identity and membership integration remains in progress** (17 October 2026).

Implemented in the current baseline:

- Clean project skeleton, Apps Script V8 manifest, and pure validation suite
- Company authorization policy with identity-match, active-membership, role, action, and tenant-scope checks
- Versioned Google Sheets data contract and dependency-injected repository
- Synthetic tests for tenant scoping, locking, idempotency/recovery, malformed stored state, and validation
- GitHub Actions validation workflow; [run #24 passed on the merged baseline](https://github.com/anelevsambo-debug/reclaim-repurpose/actions/runs/39064376066)

Stage 2 work in progress on the feature branch adds a provider-independent verified-identity boundary contract and a consent-provenance policy, with deterministic negative tests. These are **contracts and mocked tests**, not live provider integrations.

**Not implemented or proven:** Meta/WhatsApp cryptographic webhook verification, Google identity verification, authoritative membership provisioning controls, real consent capture and durable consent-event audit, a configured live workbook, real Apps Script/Sheets integration tests, AppSheet dashboards, live deployment, or operational pilot capability.

The authorization helper is not an authentication system. It must only receive a principal produced by a trusted identity adapter and membership loaded from a controlled server-side source. Do not accept these values directly from customer-controlled request fields.

A material architecture blocker remains: the documented Apps Script web-app event object exposes request parameters and POST body fields, but not HTTP request headers. Meta WhatsApp webhook authenticity normally depends on validating `X-Hub-Signature-256` against the original body. A direct Apps Script handler therefore cannot claim to verify the Meta signature using the documented event object. Do not create or enable a public handler until a compatible trusted ingress is approved.

The current repository method also expects the authenticated actor to be a company member, while customer-originated WhatsApp registration requires a separate customer identity/consent path and trusted company-routing rule. Do not conflate customer consent with company membership.

**Release rule:** Keep all public registration entry points closed until identity verification, membership provenance, consent capture, and real Apps Script/Sheets integration have separate tests and evidence. See [Stage 2 identity and membership gates](docs/digital/STAGE_2_IDENTITY_MEMBERSHIP.md).
---

*Build the smallest verifiable pilot. Prefer evidence over speculation.*
