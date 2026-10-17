'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Contract = require('../src/data-contract.js');

const created = '2026-10-17T12:00:00.000Z';
const updated = '2026-10-17T12:01:00.000Z';

function company(overrides = {}) {
  return {
    company_id: 'company-a',
    display_name: 'Recovery Co',
    country_code: 'BW',
    status: 'ACTIVE',
    created_at: created,
    updated_at: updated,
    ...overrides
  };
}

function membership(overrides = {}) {
  return {
    membership_id: 'member-1',
    company_id: 'company-a',
    identity_provider: 'WHATSAPP',
    provider_subject: 'wa:123456789',
    role: 'COMPANY_ADMIN',
    status: 'ACTIVE',
    created_at: created,
    updated_at: updated,
    ...overrides
  };
}

function registration(overrides = {}) {
  return {
    registration_id: 'reg-1',
    company_id: 'company-a',
    customer_name: 'Synthetic Customer',
    contact_identifier: '+26771111111',
    country_code: 'BW',
    service_address: '',
    status: 'PENDING',
    consent_status: 'PENDING',
    consent_at: '',
    created_at: created,
    updated_at: updated,
    ...overrides
  };
}

function dedupe(overrides = {}) {
  return {
    dedupe_id: 'dedupe-1',
    company_id: 'company-a',
    source: 'WHATSAPP',
    idempotency_key_hash: 'a'.repeat(64),
    request_fingerprint: 'b'.repeat(64),
    state: 'PROCESSING',
    registration_id: 'reg-1',
    created_at: created,
    updated_at: updated,
    ...overrides
  };
}

describe('ReclaimDataContract — schema definition', () => {
  it('publishes version 1 and the required ordered sheet headers', () => {
    const schema = Contract.getSchemaDefinition();
    assert.equal(schema.version, '1');
    assert.deepEqual(schema.sheets._Metadata, ['key', 'value']);
    assert.deepEqual(schema.sheets.Companies, [
      'company_id', 'display_name', 'country_code', 'status', 'created_at', 'updated_at'
    ]);
    assert.deepEqual(schema.sheets.CompanyMembers, [
      'membership_id', 'company_id', 'identity_provider', 'provider_subject',
      'role', 'status', 'created_at', 'updated_at'
    ]);
    assert.deepEqual(schema.sheets.Registrations, [
      'registration_id', 'company_id', 'customer_name', 'contact_identifier',
      'country_code', 'service_address', 'status', 'consent_status', 'consent_at',
      'created_at', 'updated_at'
    ]);
    assert.deepEqual(schema.sheets.RequestDedupe, [
      'dedupe_id', 'company_id', 'source', 'idempotency_key_hash',
      'request_fingerprint', 'state', 'registration_id', 'created_at', 'updated_at'
    ]);
  });

  it('returns detached header arrays that cannot mutate internal schema', () => {
    const schema = Contract.getSchemaDefinition();
    schema.sheets.Companies[0] = 'row_number';
    assert.equal(Contract.getSchemaDefinition().sheets.Companies[0], 'company_id');
  });

  it('rejects missing, reordered, extra, or unknown sheet headers', () => {
    assert.equal(Contract.validateHeaders('Companies', Contract.getSchemaDefinition().sheets.Companies).ok, true);
    assert.equal(Contract.validateHeaders('Companies', ['row_number', 'company_id']).ok, false);
    assert.equal(Contract.validateHeaders('Companies', ['company_id', 'display_name']).error.code, 'SCHEMA_HEADER_MISMATCH');
    assert.equal(Contract.validateHeaders('Companies', Contract.getSchemaDefinition().sheets.Companies.concat('unexpected')).ok, false);
    assert.equal(Contract.validateHeaders('Unknown', []).ok, false);
  });
});

describe('ReclaimDataContract — company and membership records', () => {
  it('accepts a valid company and returns a detached, allow-listed record', () => {
    const input = company({ internal_secret: 'must-not-escape' });
    const result = Contract.validateCompany(input);
    assert.equal(result.ok, true);
    assert.equal(Object.hasOwn(result.value, 'internal_secret'), false);
    result.value.display_name = 'mutated';
    assert.equal(input.display_name, 'Recovery Co');
  });

  it('rejects unsupported country, invalid status, blank name, and invalid timestamps', () => {
    assert.equal(Contract.validateCompany(company({ country_code: 'ZA' })).error.code, 'COUNTRY_UNSUPPORTED');
    assert.equal(Contract.validateCompany(company({ status: 'DELETED' })).error.code, 'COMPANY_STATUS_INVALID');
    assert.equal(Contract.validateCompany(company({ display_name: '  ' })).error.code, 'COMPANY_NAME_INVALID');
    assert.equal(Contract.validateCompany(company({ display_name: '  Recovery Co  ' })).value.display_name, 'Recovery Co');
    assert.equal(Contract.validateCompany(company({ created_at: 'yesterday' })).error.code, 'TIMESTAMP_INVALID');
    assert.equal(Contract.validateCompany(company({ updated_at: created, created_at: updated })).error.code, 'TIMESTAMP_ORDER_INVALID');
  });

  it('accepts valid membership and rejects unsupported identity providers, roles, and statuses', () => {
    assert.equal(Contract.validateMembership(membership()).ok, true);
    assert.equal(Contract.validateMembership(membership({ identity_provider: 'EMAIL' })).error.code, 'IDENTITY_PROVIDER_UNSUPPORTED');
    assert.equal(Contract.validateMembership(membership({ role: 'PLATFORM_ADMIN' })).error.code, 'MEMBERSHIP_ROLE_INVALID');
    assert.equal(Contract.validateMembership(membership({ status: 'ACTIVE ' })).error.code, 'MEMBERSHIP_STATUS_INVALID');
  });
});

describe('ReclaimDataContract — registrations and consent', () => {
  it('accepts valid registration with minimal optional personal data', () => {
    const result = Contract.validateRegistration(registration({ customer_name: '', service_address: '' }));
    assert.equal(result.ok, true);
    assert.equal(result.value.customer_name, '');
    assert.equal(result.value.service_address, '');
  });

  it('rejects missing contact identifier, bad country, and oversized address', () => {
    assert.equal(Contract.validateRegistration(registration({ contact_identifier: '' })).error.code, 'CONTACT_IDENTIFIER_INVALID');
    assert.equal(Contract.validateRegistration(registration({ contact_identifier: '26771111111' })).error.code, 'CONTACT_IDENTIFIER_INVALID');
    assert.equal(Contract.validateRegistration(registration({ customer_name: '  Synthetic Customer  ', service_address: '  Plot 12  ' })).value.customer_name, 'Synthetic Customer');
    assert.equal(Contract.validateRegistration(registration({ customer_name: 'Synthetic Customer', service_address: '  Plot 12  ' })).value.service_address, 'Plot 12');
    assert.equal(Contract.validateRegistration(registration({ country_code: 'SZL' })).error.code, 'COUNTRY_UNSUPPORTED');
    assert.equal(Contract.validateRegistration(registration({ service_address: 'x'.repeat(501) })).error.code, 'SERVICE_ADDRESS_INVALID');
  });

  it('requires a timestamp when consent is granted or withdrawn', () => {
    assert.equal(Contract.validateRegistration(registration({ consent_status: 'GRANTED', consent_at: created })).ok, true);
    assert.equal(Contract.validateRegistration(registration({ consent_status: 'GRANTED', consent_at: '' })).error.code, 'CONSENT_TIMESTAMP_REQUIRED');
    assert.equal(Contract.validateRegistration(registration({ consent_status: 'WITHDRAWN', consent_at: 'invalid' })).error.code, 'CONSENT_TIMESTAMP_REQUIRED');
  });

  it('rejects invalid statuses and invalid status transitions', () => {
    assert.equal(Contract.validateRegistration(registration({ status: 'DELETED' })).error.code, 'REGISTRATION_STATUS_INVALID');
    assert.equal(Contract.isAllowedRegistrationTransition('PENDING', 'ACTIVE'), true);
    assert.equal(Contract.isAllowedRegistrationTransition('ACTIVE', 'PAUSED'), true);
    assert.equal(Contract.isAllowedRegistrationTransition('CANCELLED', 'ACTIVE'), false);
    assert.equal(Contract.isAllowedRegistrationTransition('PENDING', 'PENDING'), false);
    assert.equal(Contract.isAllowedRegistrationTransition('UNKNOWN', 'ACTIVE'), false);
  });
});

describe('ReclaimDataContract — idempotency record', () => {
  it('accepts a processing reservation without a registration ID', () => {
    assert.equal(Contract.validateDedupeRecord(dedupe()).ok, true);
  });

  it('requires SHA-256 hex digests and a registration ID for completed records', () => {
    assert.equal(Contract.validateDedupeRecord(dedupe({ idempotency_key_hash: 'raw-event-id' })).error.code, 'DEDUPE_DIGEST_INVALID');
    assert.equal(Contract.validateDedupeRecord(dedupe({ state: 'COMPLETED', registration_id: '' })).error.code, 'DEDUPE_REGISTRATION_REQUIRED');
    assert.equal(Contract.validateDedupeRecord(dedupe({ state: 'COMPLETED', registration_id: 'reg-1' })).ok, true);
    assert.equal(Contract.validateDedupeRecord(dedupe({ state: 'PROCESSING', registration_id: 'reg-1' })).ok, true);
    assert.equal(Contract.validateDedupeRecord(dedupe({ source: 'UNTRUSTED' })).error.code, 'DEDUPE_SOURCE_INVALID');
  });
});
