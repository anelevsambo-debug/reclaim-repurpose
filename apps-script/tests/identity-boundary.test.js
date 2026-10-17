'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Boundary = require('../src/identity-boundary.js');

const NOW = Date.parse('2026-10-17T12:00:00.000Z');
const EXPECTED = {
  WHATSAPP: { issuer: 'meta.example', audience: 'reclaim-whatsapp-number' },
  GOOGLE: { issuer: 'https://accounts.google.com', audience: 'reclaim-app' }
};

function claims(overrides = {}) {
  return {
    verified: true,
    issuer: EXPECTED.WHATSAPP.issuer,
    audience: EXPECTED.WHATSAPP.audience,
    subject: 'wa:26771111111',
    eventId: 'event-123',
    issuedAt: NOW - 1000,
    expiresAt: NOW + 60_000,
    ...overrides
  };
}

function boundary(options = {}) {
  return Boundary.createIdentityBoundary({
    whatsappVerifier: options.whatsappVerifier || (() => claims()),
    googleVerifier: options.googleVerifier || (() => claims({
      issuer: EXPECTED.GOOGLE.issuer,
      audience: EXPECTED.GOOGLE.audience,
      subject: 'google:subject-123'
    })),
    expected: options.expected || EXPECTED,
    now: options.now || (() => NOW)
  });
}

describe('ReclaimIdentityBoundary — trusted verifier contract', () => {
  it('returns a server-shaped principal only after the WhatsApp verifier succeeds', () => {
    const result = boundary().verifyWhatsApp({ rawBody: 'opaque-test-envelope' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      authenticated: true,
      provider: 'WHATSAPP',
      subject: 'wa:26771111111',
      issuer: 'meta.example',
      audience: 'reclaim-whatsapp-number',
      eventId: 'event-123',
      issuedAt: new Date(NOW - 1000).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      verifiedAt: new Date(NOW).toISOString()
    });
  });

  it('chooses the Google verifier internally rather than accepting a caller-selected provider', () => {
    const result = boundary().verifyGoogle({ opaque: true });
    assert.equal(result.ok, true);
    assert.equal(result.value.provider, 'GOOGLE');
    assert.equal(result.value.subject, 'google:subject-123');
  });

  it('rejects a missing assertion without calling a verifier', () => {
    let called = false;
    const result = boundary({
      whatsappVerifier: () => { called = true; return claims(); }
    }).verifyWhatsApp(null);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'IDENTITY_ASSERTION_REQUIRED');
    assert.equal(called, false);
  });

  it('fails closed when provider verification throws or returns unverified claims', () => {
    const thrown = boundary({
      whatsappVerifier: () => { throw new Error('secret-bearing provider error'); }
    }).verifyWhatsApp({});
    const unverified = boundary({
      whatsappVerifier: () => claims({ verified: false })
    }).verifyWhatsApp({});
    assert.equal(thrown.ok, false);
    assert.equal(thrown.error.code, 'IDENTITY_VERIFICATION_FAILED');
    assert.equal(JSON.stringify(thrown).includes('secret-bearing'), false);
    assert.equal(unverified.ok, false);
  });

  it('rejects incorrect issuer and audience', () => {
    assert.equal(boundary({
      whatsappVerifier: () => claims({ issuer: 'attacker' })
    }).verifyWhatsApp({}).error.code, 'IDENTITY_ISSUER_INVALID');
    assert.equal(boundary({
      whatsappVerifier: () => claims({ audience: 'other-app' })
    }).verifyWhatsApp({}).error.code, 'IDENTITY_AUDIENCE_INVALID');
  });

  it('rejects empty, whitespace-padded, or oversized subjects and missing event IDs', () => {
    for (const subject of ['', '   ', ' wa:26771111111', 'x'.repeat(256)]) {
      assert.equal(boundary({
        whatsappVerifier: () => claims({ subject })
      }).verifyWhatsApp({}).ok, false);
    }
    assert.equal(boundary({
      whatsappVerifier: () => claims({ eventId: '' })
    }).verifyWhatsApp({}).error.code, 'IDENTITY_EVENT_ID_INVALID');
  });

  it('rejects expired, future-issued, reversed, and overlong assertions', () => {
    const invalid = [
      { expiresAt: NOW },
      { issuedAt: NOW + 60_001 },
      { issuedAt: NOW + 1000, expiresAt: NOW + 500 },
      { issuedAt: NOW - 16 * 60_000, expiresAt: NOW + 60_000 }
    ];
    for (const override of invalid) {
      assert.equal(boundary({
        whatsappVerifier: () => claims(override)
      }).verifyWhatsApp({}).error.code, 'IDENTITY_ASSERTION_EXPIRED_OR_INVALID');
    }
  });

  it('rejects missing provider configuration and an unusable clock', () => {
    assert.equal(boundary({
      expected: { WHATSAPP: { issuer: '', audience: 'aud' } }
    }).verifyWhatsApp({}).error.code, 'IDENTITY_PROVIDER_NOT_CONFIGURED');
    assert.equal(boundary({ now: () => NaN }).verifyWhatsApp({}).error.code, 'IDENTITY_CLOCK_UNAVAILABLE');
  });

  it('does not accept caller-provided identity as a substitute for verifier output', () => {
    const result = boundary({
      whatsappVerifier: () => null
    }).verifyWhatsApp({
      authenticated: true,
      provider: 'WHATSAPP',
      subject: 'wa:attacker',
      issuer: 'meta.example',
      audience: 'reclaim-whatsapp-number'
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'IDENTITY_VERIFICATION_FAILED');
  });
});
  it('rejects timestamps outside the JavaScript date range without throwing', () => {
    const result = boundary({
      whatsappVerifier: () => claims({ issuedAt: 1e100, expiresAt: 1e101 })
    }).verifyWhatsApp({});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'IDENTITY_ASSERTION_EXPIRED_OR_INVALID');
  });

