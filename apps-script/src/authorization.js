/**
 * RECLAIM & REPURPOSE – Company authorization policy (Stage 2).
 *
 * Pure policy only. This module does not authenticate a person or load a
 * membership. Callers MUST supply a principal produced by a verified identity
 * adapter and a membership loaded from the authoritative server-side store.
 * Never accept either object directly from a WhatsApp message or web request.
 */
var ReclaimAuthorization = (function () {
  'use strict';

  var COMPANY_ROLES = {
    COMPANY_ADMIN: {
      REGISTRATION_READ: true,
      REGISTRATION_CREATE: true,
      REGISTRATION_UPDATE: true,
      REGISTRATION_EXPORT: true,
      COMPANY_SETTINGS_READ: true,
      COMPANY_SETTINGS_UPDATE: true,
      MEMBER_READ: true,
      MEMBER_MANAGE: true
    },
    COMPANY_OPERATOR: {
      REGISTRATION_READ: true,
      REGISTRATION_CREATE: true,
      REGISTRATION_UPDATE: true,
      COMPANY_SETTINGS_READ: true
    }
  };

  function authorizeCompanyAction(input) {
    if (!input || typeof input !== 'object') {
      return deny('AUTHORIZATION_INPUT_REQUIRED', 'Authorization input is required');
    }

    var principal = input.principal;
    if (!principal || typeof principal !== 'object' || principal.authenticated !== true) {
      return deny('IDENTITY_NOT_VERIFIED', 'A verified identity is required');
    }

    if (principal.provider !== 'WHATSAPP' && principal.provider !== 'GOOGLE') {
      return deny('IDENTITY_PROVIDER_UNSUPPORTED', 'Identity provider is not supported');
    }

    if (typeof principal.subject !== 'string' || !principal.subject.trim()) {
      return deny('IDENTITY_SUBJECT_REQUIRED', 'A verified identity subject is required');
    }

    if (typeof input.targetCompanyId !== 'string' || !input.targetCompanyId.trim()) {
      return deny('COMPANY_REQUIRED', 'Target company is required');
    }

    var membership = input.membership;
    if (!membership || typeof membership !== 'object') {
      return deny('COMPANY_MEMBERSHIP_REQUIRED', 'Company membership is required');
    }

    if (membership.provider !== principal.provider) {
      return deny('COMPANY_MEMBERSHIP_PROVIDER_MISMATCH', 'Membership provider does not match this identity');
    }

    if (membership.status !== 'ACTIVE') {
      return deny('COMPANY_MEMBERSHIP_INACTIVE', 'Company membership is not active');
    }

    if (typeof membership.subject !== 'string' || membership.subject !== principal.subject) {
      return deny('COMPANY_MEMBERSHIP_IDENTITY_MISMATCH', 'Membership does not belong to this identity');
    }

    if (typeof membership.companyId !== 'string' ||
        membership.companyId !== input.targetCompanyId) {
      return deny('COMPANY_SCOPE_MISMATCH', 'Identity is not a member of the target company');
    }

    if (typeof membership.role !== 'string' ||
        !Object.prototype.hasOwnProperty.call(COMPANY_ROLES, membership.role)) {
      return deny('COMPANY_ROLE_UNSUPPORTED', 'Company role is not supported');
    }

    if (typeof input.action !== 'string' ||
        !Object.prototype.hasOwnProperty.call(COMPANY_ROLES[membership.role], input.action) ||
        COMPANY_ROLES[membership.role][input.action] !== true) {
      return deny('COMPANY_ACTION_FORBIDDEN', 'Role is not permitted to perform this action');
    }

    return { ok: true, value: {
      companyId: membership.companyId,
      subject: principal.subject,
      role: membership.role,
      action: input.action
    } };
  }

  function deny(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  return {
    authorizeCompanyAction: authorizeCompanyAction
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReclaimAuthorization;
}
