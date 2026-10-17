# Stage 2 — Verified Identity and Authoritative Membership Integration

**Status:** Partial code foundation; live integration blocked  
**Branch:** `stage-2-verified-identity-boundary`  
**Baseline:** `ca098027cdffd3fa12472744d6347123033d122c`  
**Security posture:** No public entry point. No deployment or live customer processing.

## 1. Baseline audit

The current `main` branch contains:

- `apps-script/src/authorization.js`: pure company-role policy. It requires a caller-supplied principal object marked `authenticated: true`; this is not identity verification.
- `apps-script/src/data-contract.js`: schema v1, including Companies, CompanyMembers, Registrations, and RequestDedupe.
- `apps-script/src/sheets-repository.js`: dependency-injected Sheets repository. It resolves a matching company membership from the configured workbook for registration operations and fails closed on missing/ambiguous membership. Its inputs still include a principal and registration consent fields supplied by its internal caller.
- Tests use in-memory spreadsheet/lock doubles; no configured workbook or real Apps Script integration is evidenced.
- No identity adapter, provider-specific verifier, consent provenance service, membership provisioning workflow, or Stage 2 roadmap document was present on `main` at the audit baseline.
- The README's Stage 2 status text is stale in places relative to the merged Stage 3 implementation. The actual merge is recorded at `ca098027cdffd3fa12472744d6347123033d122c`.

The post-merge Stage 1 Validation run succeeded on the exact current baseline commit: [run #24](https://github.com/anelevsambo-debug/reclaim-repurpose/actions/runs/39064376066). This is Node/CI evidence only, not live integration evidence.

## 2. Identity boundary implemented in this branch

`apps-script/src/identity-boundary.js` defines a provider-independent, fail-closed contract with separate server-selected methods for WhatsApp and Google. It requires a provider verifier to validate the original provider assertion and return a verified claim set. The boundary checks:

- server-configured issuer and audience;
- non-empty, bounded subject and provider event ID;
- issuance and expiry timestamps, maximum assertion lifetime, and bounded future clock skew;
- verifier exceptions, missing configuration, missing claims, and invalid assertions fail closed;
- errors do not echo provider exceptions or assertion content.

`apps-script/tests/identity-boundary.test.js` tests successful mocked verifier results and negative cases. These tests validate the boundary contract; they do **not** implement or prove Meta/Google cryptographic verification.

**Important:** A verifier must be constructed and called only by trusted server-side code. Never pass a request-supplied `authenticated`, `provider`, `subject`, `issuer`, `audience`, or verifier result directly into this boundary as if it had already been verified.

## 3. Consent provenance policy implemented in this branch

`apps-script/src/consent-policy.js` defines the allowed purpose `WASTE_COLLECTION_REGISTRATION`, requires the configured notice version, accepts only explicit `GRANT` or `WITHDRAW` decisions, and derives the recorded timestamp and event reference from the verified provider identity event rather than a separate caller-supplied timestamp.

`apps-script/tests/consent-policy.test.js` covers grant, withdrawal, missing/unverified identity, invalid purpose/version/decision, timestamp provenance, and safe errors.

This is a policy helper only. The actual provider adapter must verify the original inbound event and establish that the customer explicitly selected or sent the consent decision. The helper cannot independently prove that an event was signed or that the notice was actually shown. The current schema v1 also has no dedicated consent-event ledger; it only stores current registration consent status and timestamp. A reviewed persistence design is still required before relying on this for a live audit trail.

## 4. Critical integration blocker — WhatsApp webhook authentication

Meta WhatsApp Cloud API webhook authenticity is normally checked by validating the `X-Hub-Signature-256` request header against the raw request body and the server-held Meta app secret. The official Google Apps Script web-app event object documents query/parameter fields and POST body fields, but does not expose an HTTP request-headers field. See:

- Google Apps Script web-app event parameters: https://developers.google.com/apps-script/guides/web
- WhatsApp webhook signature handling overview: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/

Therefore, a direct Apps Script `doPost(e)` handler cannot safely claim to validate Meta's signature header using the documented event object. Do not work around this by placing the signature in a query parameter or POST body; an attacker can supply those fields too.

The repository's locked architecture excludes a separate custom backend. **Real WhatsApp identity integration remains blocked until the owner approves a compatible trusted ingress that preserves the original headers and raw body, or chooses a different supported authentication architecture.** No `doGet`/`doPost` handler is added by this branch.

A webhook verification token used for subscription setup is not a substitute for per-delivery signature validation.

## 5. Membership authority and tenant boundaries

The existing repository loads membership from the server-configured spreadsheet, checks the provider and subject, requires exactly one matching membership, validates company and membership records, and scopes reads/writes to the authorized company. This is a useful server-side policy boundary but does not establish the provenance of membership rows.

Still required before live use:

- Provision the workbook under a designated owner and verify the actual schema.
- Restrict workbook and Apps Script project editor access to named trusted administrators.
- Define and test who can add, change, suspend, and revoke CompanyMembers records.
- Add a server-side, audited membership-management path or a controlled manual provisioning procedure with change evidence.
- Define revocation expectations and ensure each protected operation resolves current membership.
- Prevent company users from directly editing the underlying membership and registration sheets.
- Verify duplicate logical membership handling under real Apps Script execution.

Google Sheets has no database-enforced unique constraint or multi-row transaction. The existing script lock coordinates cooperating code in the same Apps Script project; it does not protect against manual spreadsheet edits or another script project.

## 6. Unresolved actor and tenant assignment model

The existing repository authorizes registration creation by requiring the request principal to be an active member of the target company. The product also describes customer registration through WhatsApp. A customer sending a message is not automatically a CompanyMember.

Before implementing a live customer flow, define separately:

1. **Company actor identity** — a company administrator/operator who can manage company registrations.
2. **Customer identity/contact** — the customer who is requesting collection.
3. **Company routing** — a trusted rule, such as a server-configured business phone-number ID or an approved company-specific onboarding route, that determines the target company without trusting a customer-supplied company ID.
4. **Consent evidence** — the customer's explicit consent event, tied to the verified customer/source event and the notice version.

Do not conflate customer consent with company membership. Do not grant company roles to customers just to make the current repository method accept them.

## 7. Required real integration evidence

Still blocked / not verified:

- Configured Meta WhatsApp Business Account, phone-number ID, app secret, webhook subscription, and trusted ingress.
- Real signature-validation tests against authentic provider requests and altered-body/invalid-signature cases.
- Google identity provider configuration if Google is selected for company actors.
- Owner-provisioned test workbook and exact schema verification.
- Restricted workbook and Apps Script access, Script Properties configuration, and audit procedure.
- Real Apps Script/Sheets tests proving that failed authentication, membership, or consent checks perform no writes.
- Persistent idempotency/replay handling for provider event IDs.
- A dedicated consent event ledger or reviewed retention/audit alternative.
- A defined company-routing model for customer-originated WhatsApp registration.

Never commit secrets or claim a mocked verifier proves real identity.

## 8. Gate verdict

| Criterion | Status |
|---|---|
| Current baseline and CI inspected | Verified |
| Provider-independent identity boundary contract | Implemented in branch; mocked tests pending CI |
| Cryptographic WhatsApp/Google verifier | Blocked — no provider/configuration; WhatsApp header access incompatible with direct documented Apps Script event object |
| Existing server-side membership lookup and company scoping | Implemented in Stage 3 code; real source provenance not verified |
| Membership provisioning/revocation controls | Not verified |
| Consent policy helper | Implemented in branch; mocked tests pending CI |
| Real consent capture and auditable persistence | Blocked |
| Real Apps Script/Sheets integration | Not verified |
| Public registration endpoint | Not created; remains closed |
| Stage 2 complete | **No** |

The next action is to review this branch and its CI results, then obtain the owner's decision on the trusted WhatsApp ingress and company/customer identity model. Do not enable public registration until all real integration and security gates have independent evidence.
