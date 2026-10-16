'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ReclaimValidation = require('../src/validation.js');

describe('ReclaimValidation – Country', () => {
  it('accepts BOTSWANA', () => {
    const r = ReclaimValidation.validateCountry('BOTSWANA');
    assert.equal(r.ok, true);
    assert.equal(r.value.currency, 'BWP');
    assert.equal(r.value.code, 'BW');
  });

  it('accepts ESWATINI (case-insensitive)', () => {
    const r = ReclaimValidation.validateCountry('eswatini');
    assert.equal(r.ok, true);
    assert.equal(r.value.currency, 'SZL');
  });

  it('rejects unknown country', () => {
    const r = ReclaimValidation.validateCountry('SOUTH_AFRICA');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'COUNTRY_UNSUPPORTED');
  });

  it('rejects empty country', () => {
    const r = ReclaimValidation.validateCountry('');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'COUNTRY_REQUIRED');
  });
});

describe('ReclaimValidation – Currency', () => {
  it('accepts matching currency', () => {
    const r = ReclaimValidation.validateCurrency('BWP', 'BWP');
    assert.equal(r.ok, true);
    assert.equal(r.value, 'BWP');
  });

  it('rejects mismatched currency', () => {
    const r = ReclaimValidation.validateCurrency('SZL', 'BWP');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'CURRENCY_MISMATCH');
  });
});

describe('ReclaimValidation – Money', () => {
  it('accepts valid positive amount', () => {
    const r = ReclaimValidation.validateMoney(125.5);
    assert.equal(r.ok, true);
    assert.equal(r.value, 125.5);
  });

  it('accepts zero', () => {
    const r = ReclaimValidation.validateMoney(0);
    assert.equal(r.ok, true);
  });

  it('rejects negative', () => {
    const r = ReclaimValidation.validateMoney(-10);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'MONEY_NEGATIVE');
  });

  it('rejects non-finite', () => {
    const r = ReclaimValidation.validateMoney(NaN);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'MONEY_INVALID');
  });

  it('rejects excessive precision', () => {
    const r = ReclaimValidation.validateMoney(10.123);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'MONEY_PRECISION');
  });
});

describe('ReclaimValidation – Organisation', () => {
  it('accepts minimal valid organisation (Botswana)', () => {
    const r = ReclaimValidation.validateOrganisation({
      name: 'Gaborone Recovery Co',
      country: 'BOTSWANA'
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.currency, 'BWP');
    assert.equal(r.value.status, 'PENDING');
    assert.equal(r.value.country, 'BW');
  });

  it('accepts full organisation (Eswatini)', () => {
    const r = ReclaimValidation.validateOrganisation({
      name: 'Mbabane Materials',
      country: 'ESWATINI',
      currency: 'SZL',
      status: 'ACTIVE'
    });
    assert.equal(r.ok, true);
    assert.equal(r.value.currency, 'SZL');
    assert.equal(r.value.status, 'ACTIVE');
  });

  it('rejects currency mismatch', () => {
    const r = ReclaimValidation.validateOrganisation({
      name: 'Test',
      country: 'BOTSWANA',
      currency: 'SZL'
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'CURRENCY_MISMATCH');
  });

  it('rejects missing name', () => {
    const r = ReclaimValidation.validateOrganisation({
      country: 'BOTSWANA'
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'ORGANISATION_NAME_REQUIRED');
  });

  it('rejects unsupported status', () => {
    const r = ReclaimValidation.validateOrganisation({
      name: 'Test',
      country: 'BOTSWANA',
      status: 'ARCHIVED'
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'ORGANISATION_STATUS_UNSUPPORTED');
  });
});
