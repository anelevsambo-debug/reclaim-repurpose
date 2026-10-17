/**
 * RECLAIM & REPURPOSE — consent provenance policy (Stage 2).
 *
 * This policy accepts only a principal produced by ReclaimIdentityBoundary.
 * It must be called from trusted server-side code, never directly from a web
 * request. The provider verifier must authenticate the original event bytes.
 */
var ReclaimConsentPolicy = (function () {
  'use strict';

  var PURPOSE = 'WASTE_COLLECTION_REGISTRATION';
  var DECISIONS = ['GRANT', 'WITHDRAW'];

  function createConsentPolicy(configuration) {
    if (!configuration || typeof configuration !== 'object' ||
        !isText(configuration.noticeVersion, 100)) {
      throw new Error('A consent notice version is required');
    }

    return {
      recordDecision: function (input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          return deny('CONSENT_EVENT_REQUIRED');
        }

        var identity = input.verifiedIdentity;
        if (!identity || typeof identity !== 'object' ||
            identity.authenticated !== true ||
            (identity.provider !== 'WHATSAPP' && identity.provider !== 'GOOGLE') ||
            !isText(identity.subject, 255) ||
            !isText(identity.eventId, 255) ||
            !isText(identity.issuedAt, 40) ||
            !isValidTimestamp(identity.issuedAt)) {
          return deny('CONSENT_IDENTITY_UNVERIFIED');
        }

        if (input.purpose !== PURPOSE) return deny('CONSENT_PURPOSE_INVALID');
        if (input.noticeVersion !== configuration.noticeVersion) {
          return deny('CONSENT_NOTICE_VERSION_INVALID');
        }
        if (DECISIONS.indexOf(input.decision) === -1) {
          return deny('CONSENT_DECISION_INVALID');
        }

        return {
          ok: true,
          value: {
            provider: identity.provider,
            subject: identity.subject,
            eventId: identity.eventId,
            purpose: PURPOSE,
            noticeVersion: configuration.noticeVersion,
            decision: input.decision,
            occurredAt: identity.issuedAt,
            source: identity.provider,
            provenance: 'VERIFIED_PROVIDER_EVENT'
          }
        };
      }
    };
  }

  function isText(value, maxLength) {
    return typeof value === 'string' && value.trim().length > 0 &&
      value.length <= maxLength && value === value.trim();
  }

  function isValidTimestamp(value) {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    return !isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  }

  function deny(code) {
    return { ok: false, error: { code: code, message: 'Consent evidence could not be validated' } };
  }

  return { createConsentPolicy: createConsentPolicy };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReclaimConsentPolicy;
}
