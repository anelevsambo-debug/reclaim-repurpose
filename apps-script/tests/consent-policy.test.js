'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Consent = require('../src/consent-policy.js');

const NOW = '2026-10-17T12:00:00.000Z';

function identity(overrides = {}) {
  return {
    authenticated: true,
    provider: 'WHATSAPP',
    subject: 'wa:26771111111',
    eventId: 'signed-event-123',
    issuedAt: NOW,
    expiresAt: '2026-10-17T12:01:00.000Z',
    verifiedAt: NOW,
    ...overrides
  };
}

function policy() {
  return Consent.createConsentPolicy({ noticeVersion: 'registration-v1' });
}

function event(overrides = {}) {
  return {
    verifiedIdentity: identity(),
    purpose: 'WASTE_COLLECTION_REGISTRATION',
    noticeVersion: 'registration-v1',
    decision: 'GRANT',
    ...overrides
  };
}

describe('ReclaimConsentPolicy — consent provenance', () => {
  it('records a grant using the verified provider event identity and timestamp', () => {
    const result = policy().recordDecision(event());
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      provider: 'WHATSAPP',
      subject: 'wa:26771111111',
      eventId: 'signed-event-123',
      purpose: 'WASTE_COLLECTION_REGISTRATION',
      noticeVersion: 'registration-v1',
      decision: 'GRANT',
      occurredAt: NOW,
      source: 'WHATSAPP',
      provenance: 'VERIFIED_PROVIDER_EVENT'
    });
  });

  it('supports an explicit withdrawal as a distinct decision', () => {
    const result = policy().recordDecision(event({ decision: 'WITHDRAW' }));
    assert.equal(result.ok, true);
    assert.equal(result.value.decision, 'WITHDRAW');
  });

  it('rejects missing or unverified identity and does not trust caller timestamps', () => {
    assert.equal(policy().recordDecision(event({ verifiedIdentity: null })).error.code,
      'CONSENT_IDENTITY_UNVERIFIED');
    assert.equal(policy().recordDecision(event({
      verifiedIdentity: identity({ authenticated: false })
    })).error.code, 'CONSENT_IDENTITY_UNVERIFIED');
    assert.equal(policy().recordDecision(event({
      verifiedIdentity: identity({ issuedAt: 'not-a-time' })
    })).error.code, 'CONSENT_IDENTITY_UNVERIFIED');
    const result = policy().recordDecision(event({ occurredAt: '1900-01-01T00:00:00.000Z' }));
    assert.equal(result.ok, true);
    assert.equal(result.value.occurredAt, NOW);
  });

  it('rejects purpose and notice versions not configured by the server', () => {
    assert.equal(policy().recordDecision(event({ purpose: 'MARKETING' })).error.code,
      'CONSENT_PURPOSE_INVALID');
    assert.equal(policy().recordDecision(event({ noticeVersion: 'attacker-version' })).error.code,
      'CONSENT_NOTICE_VERSION_INVALID');
  });

  it('rejects missing, ambiguous, or caller-invented decisions', () => {
    for (const decision of ['', 'YES', 'GRANTED', 'true', null]) {
      assert.equal(policy().recordDecision(event({ decision })).error.code,
        'CONSENT_DECISION_INVALID');
    }
  });

  it('rejects malformed consent policy configuration', () => {
    assert.throws(() => Consent.createConsentPolicy({ noticeVersion: '  ' }));
  });

  it('returns safe errors without echoing event content', () => {
    const result = policy().recordDecision(event({
      verifiedIdentity: identity({ authenticated: false, subject: 'private-contact-value' })
    }));
    assert.equal(JSON.stringify(result).includes('private-contact-value'), false);
  });
});
