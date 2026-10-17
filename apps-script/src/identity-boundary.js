/**
 * RECLAIM & REPURPOSE — verified identity boundary (Stage 2).
 *
 * This is an adapter contract, not a provider implementation. Provider-specific
 * verifiers must authenticate the original provider assertion/event before
 * returning claims. Never pass caller-supplied identity fields as verifier output.
 * No public Apps Script handler is created here.
 */
var ReclaimIdentityBoundary = (function () {
  'use strict';

  var MAX_ASSERTION_LIFETIME_MS = 15 * 60 * 1000;
  var FUTURE_CLOCK_SKEW_MS = 60 * 1000;

  function createIdentityBoundary(dependencies) {
    if (!dependencies || typeof dependencies !== 'object') {
      throw new Error('Identity boundary dependencies are required');
    }
    if (typeof dependencies.whatsappVerifier !== 'function' ||
        typeof dependencies.googleVerifier !== 'function' ||
        typeof dependencies.now !== 'function' ||
        !dependencies.expected || typeof dependencies.expected !== 'object') {
      throw new Error('Identity verifier configuration is incomplete');
    }

    return {
      verifyWhatsApp: function (assertion) {
        return verify('WHATSAPP', dependencies.whatsappVerifier, assertion);
      },
      verifyGoogle: function (assertion) {
        return verify('GOOGLE', dependencies.googleVerifier, assertion);
      }
    };

    function verify(provider, verifier, assertion) {
      if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) {
        return deny('IDENTITY_ASSERTION_REQUIRED');
      }

      var claims;
      try {
        // The verifier must validate cryptographic/provider authenticity using
        // server-controlled configuration and the original assertion bytes.
        claims = verifier(assertion);
      } catch (ignored) {
        return deny('IDENTITY_VERIFICATION_FAILED');
      }

      if (!claims || typeof claims !== 'object' || claims.verified !== true) {
        return deny('IDENTITY_VERIFICATION_FAILED');
      }

      var expected = dependencies.expected[provider];
      if (!expected || !isNonEmptyText(expected.issuer, 255) ||
          !isNonEmptyText(expected.audience, 255)) {
        return deny('IDENTITY_PROVIDER_NOT_CONFIGURED');
      }
      if (claims.issuer !== expected.issuer) return deny('IDENTITY_ISSUER_INVALID');
      if (claims.audience !== expected.audience) return deny('IDENTITY_AUDIENCE_INVALID');
      if (!isNonEmptyText(claims.subject, 255) || claims.subject !== claims.subject.trim()) {
        return deny('IDENTITY_SUBJECT_INVALID');
      }
      if (!isNonEmptyText(claims.eventId, 255) || claims.eventId !== claims.eventId.trim()) {
        return deny('IDENTITY_EVENT_ID_INVALID');
      }
      if (typeof claims.issuedAt !== 'number' || !isFinite(claims.issuedAt) ||
          typeof claims.expiresAt !== 'number' || !isFinite(claims.expiresAt)) {
        return deny('IDENTITY_TIME_CLAIMS_INVALID');
      }

      var currentTime = dependencies.now();
      if (typeof currentTime !== 'number' || !isFinite(currentTime)) {
        return deny('IDENTITY_CLOCK_UNAVAILABLE');
      }
      if (!isValidDateMillis(claims.issuedAt) || !isValidDateMillis(claims.expiresAt) ||
          !isValidDateMillis(currentTime) ||
          claims.issuedAt > currentTime + FUTURE_CLOCK_SKEW_MS ||
          claims.expiresAt <= currentTime ||
          claims.expiresAt <= claims.issuedAt ||
          claims.expiresAt - claims.issuedAt > MAX_ASSERTION_LIFETIME_MS) {
        return deny('IDENTITY_ASSERTION_EXPIRED_OR_INVALID');
      }

      return {
        ok: true,
        value: {
          authenticated: true,
          provider: provider,
          subject: claims.subject,
          issuer: claims.issuer,
          audience: claims.audience,
          eventId: claims.eventId,
          issuedAt: new Date(claims.issuedAt).toISOString(),
          expiresAt: new Date(claims.expiresAt).toISOString(),
          verifiedAt: new Date(currentTime).toISOString()
        }
      };
    }
  }

  function isValidDateMillis(value) {
    var date = new Date(value);
    return !isNaN(date.getTime());
  }

  function isNonEmptyText(value, maxLength) {
    return typeof value === 'string' && value.length > 0 &&
      value.length <= maxLength && value.trim().length > 0;
  }

  function deny(code) {
    return { ok: false, error: { code: code, message: 'Identity could not be verified' } };
  }

  return { createIdentityBoundary: createIdentityBoundary };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReclaimIdentityBoundary;
}
