# Stage 3 — Versioned Google Sheets Data Contract

**Status:** Design baseline, schema version 1  
**Date:** 17 October 2026  
**Scope:** Multi-company waste-collection registration pilot  
**Architecture:** Google Apps Script + Google Sheets; no public endpoint or live integration is established by this document.

## 1. Design constraints

- Google Sheets is the pilot's only persistence store. It is not a relational database and does not provide multi-row transactions or database-enforced unique constraints.
- All spreadsheet access must be server-side. A spreadsheet ID is loaded only from trusted Apps Script Script Properties; it is never accepted from a caller.
- A single Apps Script project lock must cover each complete read/check/write critical section for registration idempotency. This serializes operations in the same script project but does not create a database transaction.
- No customer-facing or staff-facing web-app endpoint may be published until verified identity and server-side membership resolution are implemented.
- AppSheet filters and hidden columns are not authorization boundaries. Do not share customer sheets directly with company users until a separately verified access design exists.
- Store the minimum personal data needed to arrange collection. Restrict spreadsheet access to the smallest trusted operations group; retention and deletion must be defined before a live pilot.

## 2. Schema versioning and workbook layout

The workbook has exactly these required tabs for schema version 1:

1. `_Metadata`
2. `Companies`
3. `CompanyMembers`
4. `Registrations`
5. `RequestDedupe`

The first row of every data tab is its exact, ordered header row. Header mismatch, duplicate headers, missing tabs, extra schema versions, or a missing metadata version must fail closed. Do not silently create or repair production tabs at request time.

The `_Metadata` tab has columns `key`, `value`; it must contain exactly one `schema_version` key with value `1`. Schema upgrades are deliberate migrations performed with writes disabled, a verified backup, and a reviewed migration record. Unknown versions are rejected.

## 3. Entity contracts

All IDs are opaque, stable strings generated server-side. IDs must not be spreadsheet row numbers. Use UUIDs where the Apps Script runtime supports `Utilities.getUuid()`; tests inject an ID generator. Timestamps are UTC ISO-8601 strings (for example `2026-10-17T12:34:56.000Z`) generated server-side. The Apps Script project timezone remains `Africa/Gaborone` for display only; it must not change stored timestamps.

### Companies

Exact headers:

`company_id, display_name, country_code, status, created_at, updated_at`

- `company_id`: required stable ID; unique within the workbook.
- `display_name`: trimmed non-empty string, maximum 200 characters.
- `country_code`: ISO-style project code `BW` or `SZ`; country policy is mapped by the existing validation module to BWP or SZL when currency is needed.
- `status`: `PENDING`, `ACTIVE`, or `INACTIVE`.
- `created_at`, `updated_at`: UTC ISO-8601 timestamps; update time must not precede creation time.

Currency is deliberately not persisted separately in v1: it is derived from the validated country policy, preventing country/currency mismatch.

### CompanyMembers

Exact headers:

`membership_id, company_id, identity_provider, provider_subject, role, status, created_at, updated_at`

- `membership_id`: required stable ID; unique.
- `company_id`: required existing company ID.
- `identity_provider`: `GOOGLE` or `WHATSAPP`.
- `provider_subject`: required opaque provider subject, stored as text; never store access tokens, verification codes, session cookies, or raw credentials.
- `role`: `COMPANY_ADMIN` or `COMPANY_OPERATOR`.
- `status`: `ACTIVE`, `SUSPENDED`, or `REVOKED`.
- `created_at`, `updated_at`: UTC timestamps.

The logical membership key is `identity_provider + provider_subject + company_id`. Google Sheets cannot enforce this uniqueness. Membership creation must run under the script lock and reject duplicates. A request must fail closed if more than one matching membership exists. Identity verification is a separate missing integration; a row in this sheet is not proof that a caller owns the identity.

### Registrations

Exact headers:

`registration_id, company_id, customer_name, contact_identifier, country_code, service_address, status, consent_status, consent_at, created_at, updated_at`

- `registration_id`: required stable server-generated ID; unique.
- `company_id`: required existing company ID and tenant scope.
- `customer_name`: optional, trimmed, maximum 200 characters; collect only if operationally necessary.
- `contact_identifier`: required only for a contact channel that needs a reply, normalized before storage; treat as personal data and never expose it in logs. Do not collect it until consent and a valid channel flow exist.
- `country_code`: `BW` or `SZ`; must agree with the selected company's country unless an explicit reviewed cross-border policy is introduced.
- `service_address`: optional, maximum 500 characters; collect only when needed to provide the service. Avoid precise location data unless required.
- `status`: `PENDING`, `ACTIVE`, `PAUSED`, or `CANCELLED`.
- `consent_status`: `NOT_REQUESTED`, `PENDING`, `GRANTED`, or `WITHDRAWN`.
- `consent_at`: empty unless consent was granted or withdrawn; otherwise UTC timestamp of the latest consent change.
- `created_at`, `updated_at`: UTC timestamps.

Initial allowed status transitions:

- `PENDING -> ACTIVE | CANCELLED`
- `ACTIVE -> PAUSED | CANCELLED`
- `PAUSED -> ACTIVE | CANCELLED`
- `CANCELLED` is terminal in v1; a new registration is required to re-enrol.

Consent is not implied by registration or by a successful message delivery. A withdrawal must stop subsequent non-essential contact and be retained only as long as needed to honor the withdrawal and applicable retention rules.

### RequestDedupe

Exact headers:

`dedupe_id, company_id, source, idempotency_key_hash, request_fingerprint, state, registration_id, created_at, updated_at`

- `dedupe_id`: stable server-generated ID; unique.
- `company_id`: tenant scope.
- `source`: a fixed allow-listed source such as `WHATSAPP` or `INTERNAL`; never arbitrary client text.
- `idempotency_key_hash`: SHA-256 digest of a bounded, non-empty source event key, namespaced by company and source before hashing. Do not store raw provider event payloads.
- `request_fingerprint`: SHA-256 digest of the canonical validated registration input. It detects reuse of the same idempotency key with different input.
- `state`: `PROCESSING` or `COMPLETED`.
- `registration_id`: empty while processing; stable registration ID when completed.
- `created_at`, `updated_at`: UTC timestamps.

Logical uniqueness is `company_id + source + idempotency_key_hash`. Under the script lock, reserve a `PROCESSING` row before creating a registration. A retry with the same key and fingerprint returns the existing registration only if the dedupe row is `COMPLETED`; a different fingerprint is a conflict; a still-`PROCESSING` row returns a safe retryable/in-progress result and must not create another registration. Complete the dedupe row only after the registration write succeeds.

Because Google Sheets has no transaction, a crash after writing a registration but before marking the dedupe row `COMPLETED` can leave a stuck `PROCESSING` row. Never automatically create a second registration in this case. A restricted reconciliation process must inspect and repair it using the same lock and audit evidence. This is duplicate resistance, not a claim of exactly-once delivery.

## 4. Trust boundary and data flow

1. A future transport verifies the incoming provider's authenticity and derives a principal from verified evidence.
2. A server-side membership resolver queries `CompanyMembers` using the verified provider and subject. Zero matches, multiple matches where one is expected, inactive membership, or invalid company status deny the operation.
3. The existing `ReclaimAuthorization` policy receives only the trusted principal, authoritative membership, server-selected target company, and action.
4. The authorized service derives tenant scope from the authorization decision. It must not use a caller-supplied company ID as authority.
5. The repository validates its inputs, resolves the configured workbook from Script Properties, checks schema metadata and exact headers, and performs the complete duplicate reservation/write sequence under a script lock.
6. The caller receives a minimal result (registration ID and safe status), never raw rows, spreadsheet errors, secrets, or another tenant's data.

Stages 3 and 2 remain separate gates: a data schema and tested repository do not prove identity verification. Until Stage 2's real identity and membership boundary exists, all live registration entry points remain disabled.

## 5. Configuration and failure behavior

- Required trusted Script Property: `RECLAIM_SPREADSHEET_ID`.
- The property must be set by a trusted project administrator; do not accept the ID in request JSON, query parameters, or spreadsheet data.
- Missing or malformed configuration, inaccessible workbook, missing tab, header mismatch, unknown schema version, failed lock acquisition, ambiguous membership, and partial write all fail closed.
- Caller-facing errors must use stable error codes and generic messages. Detailed exception objects may be recorded only in restricted server logs after removing personal data and secrets.
- Do not use `SpreadsheetApp.openById` with caller-controlled values.
- Do not expose internal repository helpers as public web-app entry points. No `doGet` or `doPost` endpoint is in scope for Stage 3.

## 6. Concurrency, integrity, and operational limits

- Acquire the Apps Script script lock before reading dedupe state and hold it through reservation, registration creation, and dedupe completion. Release it in a `finally` block.
- All code paths that create or mutate registration/dedupe rows must use the same lock protocol.
- Re-read relevant rows after acquiring the lock; a check done before locking is not authoritative.
- Validate headers and schema before interpreting rows.
- Escape or safely handle untrusted text before any downstream display/export; do not execute spreadsheet formulas from user input.
- Google Sheets has quotas, no relational foreign-key enforcement, no atomic multi-row transaction, and limited audit guarantees. Keep the pilot low-volume and back up the workbook. Move to a transactional database only if the pilot constraints are formally changed; that is out of scope for this version.
- Locking protects cooperating code in the same Apps Script project. It does not protect against manual spreadsheet edits or another script project writing to the workbook. Restrict editor access and document manual changes.

## 7. Privacy, retention, and deletion

Before live collection, publish a plain-language privacy notice and define purpose, lawful basis/consent where applicable, retention period, deletion handling, access controls, and a process for correction/withdrawal. Do not collect real customer records in test fixtures. Use synthetic contacts and addresses in tests. Limit logs to correlation IDs and stable error codes. Deletion must consider active service needs, legal obligations, consent withdrawals, and dedupe/audit retention; no universal retention period is assumed by this schema.

## 8. Migration and release procedure

1. Disable writes and take a verified backup.
2. Review the proposed schema migration and update this versioned contract.
3. Create/verify exact tabs and headers using a restricted administrative setup procedure.
4. Set `schema_version` only after the complete workbook matches the reviewed schema.
5. Run a read-only schema verification and a synthetic create/retry/recovery test in a non-production workbook.
6. Record the script version, workbook schema version, test evidence, operator, and timestamp.
7. Enable any entry point only after identity, authorization, persistence, and privacy gates pass.

## 9. Evidence status

This file specifies the contract. It does not prove that a workbook exists, that Script Properties are configured, that Apps Script can access a live workbook, that a real identity adapter exists, or that any production deployment has passed. Those require separate integration evidence.
