'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ReclaimAuthorization = require('../src/authorization.js');

function request(overrides = {}) {
  return {
    principal: {
      authenticated: true,
      provider: 'WHATSAPP',
      subject: 'wa:15551234567'
    },
    membership: {
      subject: 'wa:15551234567',
      companyId: 'company-a',
      role: 'COMPANY_ADMIN',
      status: 'ACTIVE'
    },
    targetCompanyId: 'company-a',
    action: 'REGISTRATION_READ',
    ...overrides
  };
}

describe('ReclaimAuthorization – allowed actions', () => {
  it('allows an active company admin to read registrations within their company', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request());
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      companyId: 'company-a',
      subject: 'wa:15551234567',
      role: 'COMPANY_ADMIN',
      action: 'REGISTRATION_READ'
    });
  });

  it('allows a company operator to read registrations within their company', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      membership: {
        subject: 'wa:15551234567',
        companyId: 'company-a',
        role: 'COMPANY_OPERATOR',
        status: 'ACTIVE'
      }
    }));
    assert.equal(result.ok, true);
  });

  it('allows a company operator to create registrations within their company', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      membership: {
        subject: 'wa:15551234567',
        companyId: 'company-a',
        role: 'COMPANY_OPERATOR',
        status: 'ACTIVE'
      },
      action: 'REGISTRATION_CREATE'
    }));
    assert.equal(result.ok, true);
  });

  it('allows Google identity only when the trusted adapter marks it authenticated', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      principal: {
        authenticated: true,
        provider: 'GOOGLE',
        subject: 'google:user-123'
      },
      membership: {
        subject: 'google:user-123',
        companyId: 'company-a',
        role: 'COMPANY_ADMIN',
        status: 'ACTIVE'
      }
    }));
    assert.equal(result.ok, true);
  });
});

describe('ReclaimAuthorization – fail-closed identity and tenant boundaries', () => {
  it('rejects missing authorization input', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(null);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTHORIZATION_INPUT_REQUIRED');
  });

  it('rejects an unauthenticated principal', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      principal: { authenticated: false, provider: 'WHATSAPP', subject: 'wa:15551234567' }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'IDENTITY_NOT_VERIFIED');
  });

  it('rejects unsupported identity providers', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      principal: { authenticated: true, provider: 'UNTRUSTED', subject: 'wa:15551234567' }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'IDENTITY_PROVIDER_UNSUPPORTED');
  });

  it('rejects an empty identity subject', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      principal: { authenticated: true, provider: 'WHATSAPP', subject: ' ' }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'IDENTITY_SUBJECT_REQUIRED');
  });

  it('rejects missing company membership', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({ membership: null }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_MEMBERSHIP_REQUIRED');
  });

  it('rejects inactive membership', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      membership: {
        subject: 'wa:15551234567',
        companyId: 'company-a',
        role: 'COMPANY_ADMIN',
        status: 'SUSPENDED'
      }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_MEMBERSHIP_INACTIVE');
  });

  it('rejects a membership belonging to another identity', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      membership: {
        subject: 'wa:19999999999',
        companyId: 'company-a',
        role: 'COMPANY_ADMIN',
        status: 'ACTIVE'
      }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_MEMBERSHIP_IDENTITY_MISMATCH');
  });

  it('rejects access to another company', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      targetCompanyId: 'company-b'
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_SCOPE_MISMATCH');
  });

  it('rejects unsupported roles', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      membership: {
        subject: 'wa:15551234567',
        companyId: 'company-a',
        role: 'PLATFORM_ADMIN',
        status: 'ACTIVE'
      }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_ROLE_UNSUPPORTED');
  });

  it('rejects actions not granted to a company operator', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      membership: {
        subject: 'wa:15551234567',
        companyId: 'company-a',
        role: 'COMPANY_OPERATOR',
        status: 'ACTIVE'
      },
      action: 'REGISTRATION_EXPORT'
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_ACTION_FORBIDDEN');
  });

  it('rejects unknown actions even for a company admin', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      action: 'DELETE_ALL_COMPANIES'
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_ACTION_FORBIDDEN');
  });

  it('rejects missing target company', () => {
    const result = ReclaimAuthorization.authorizeCompanyAction(request({
      targetCompanyId: ''
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_REQUIRED');
  });
});
