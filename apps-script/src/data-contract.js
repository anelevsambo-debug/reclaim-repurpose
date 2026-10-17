/**
 * RECLAIM & REPURPOSE — version 1 data contract.
 *
 * Pure validation only. No Google services, identity verification, or persistence.
 * This module is intentionally dependency-injected at the repository boundary.
 */
var ReclaimDataContract = (function () {
  'use strict';

  var SCHEMA_VERSION = '1';
  var SHEETS = {
    _Metadata: ['key', 'value'],
    Companies: ['company_id', 'display_name', 'country_code', 'status', 'created_at', 'updated_at'],
    CompanyMembers: ['membership_id', 'company_id', 'identity_provider', 'provider_subject', 'role', 'status', 'created_at', 'updated_at'],
    Registrations: ['registration_id', 'company_id', 'customer_name', 'contact_identifier', 'country_code', 'service_address', 'status', 'consent_status', 'consent_at', 'created_at', 'updated_at'],
    RequestDedupe: ['dedupe_id', 'company_id', 'source', 'idempotency_key_hash', 'request_fingerprint', 'state', 'registration_id', 'created_at', 'updated_at']
  };
  var COMPANY_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE'];
  var MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'];
  var ROLES = ['COMPANY_ADMIN', 'COMPANY_OPERATOR'];
  var PROVIDERS = ['GOOGLE', 'WHATSAPP'];
  var REGISTRATION_STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED'];
  var CONSENT_STATUSES = ['NOT_REQUESTED', 'PENDING', 'GRANTED', 'WITHDRAWN'];
  var DEDUPE_STATES = ['PROCESSING', 'COMPLETED'];
  var SOURCES = ['WHATSAPP', 'INTERNAL'];
  var TRANSITIONS = {
    PENDING: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['PAUSED', 'CANCELLED'],
    PAUSED: ['ACTIVE', 'CANCELLED'],
    CANCELLED: []
  };

  function validateCompany(input) {
    if (!isRecord(input)) return fail('COMPANY_INVALID', 'Company record is required');
    if (!validId(input.company_id)) return fail('COMPANY_ID_INVALID', 'Company ID is invalid');
    if (!validText(input.display_name, 200, false)) return fail('COMPANY_NAME_INVALID', 'Company name is invalid');
    if (!oneOf(input.country_code, ['BW', 'SZ'])) return fail('COUNTRY_UNSUPPORTED', 'Country is unsupported');
    if (!oneOf(input.status, COMPANY_STATUSES)) return fail('COMPANY_STATUS_INVALID', 'Company status is invalid');
    var time = validateTimestamps(input);
    if (!time.ok) return time;
    return ok(copyFields(input, SHEETS.Companies));
  }

  function validateMembership(input) {
    if (!isRecord(input)) return fail('MEMBERSHIP_INVALID', 'Membership record is required');
    if (!validId(input.membership_id) || !validId(input.company_id)) {
      return fail('MEMBERSHIP_ID_INVALID', 'Membership or company ID is invalid');
    }
    if (!oneOf(input.identity_provider, PROVIDERS)) return fail('IDENTITY_PROVIDER_UNSUPPORTED', 'Identity provider is unsupported');
    if (!validText(input.provider_subject, 255, false)) return fail('IDENTITY_SUBJECT_INVALID', 'Provider subject is invalid');
    if (!oneOf(input.role, ROLES)) return fail('MEMBERSHIP_ROLE_INVALID', 'Membership role is invalid');
    if (!oneOf(input.status, MEMBER_STATUSES)) return fail('MEMBERSHIP_STATUS_INVALID', 'Membership status is invalid');
    var time = validateTimestamps(input);
    if (!time.ok) return time;
    return ok(copyFields(input, SHEETS.CompanyMembers));
  }

  function validateRegistration(input) {
    if (!isRecord(input)) return fail('REGISTRATION_INVALID', 'Registration record is required');
    if (!validId(input.registration_id) || !validId(input.company_id)) {
      return fail('REGISTRATION_ID_INVALID', 'Registration or company ID is invalid');
    }
    if (input.customer_name !== '' && input.customer_name !== null &&
        input.customer_name !== undefined && !validText(input.customer_name, 200, true)) {
      return fail('CUSTOMER_NAME_INVALID', 'Customer name is invalid');
    }
    if (!validText(input.contact_identifier, 255, false)) {
      return fail('CONTACT_IDENTIFIER_INVALID', 'Contact identifier is invalid');
    }
    if (!oneOf(input.country_code, ['BW', 'SZ'])) return fail('COUNTRY_UNSUPPORTED', 'Country is unsupported');
    if (input.service_address !== '' && input.service_address !== null &&
        input.service_address !== undefined && !validText(input.service_address, 500, true)) {
      return fail('SERVICE_ADDRESS_INVALID', 'Service address is invalid');
    }
    if (!oneOf(input.status, REGISTRATION_STATUSES)) return fail('REGISTRATION_STATUS_INVALID', 'Registration status is invalid');
    if (!oneOf(input.consent_status, CONSENT_STATUSES)) return fail('CONSENT_STATUS_INVALID', 'Consent status is invalid');
    if (input.consent_status === 'GRANTED' || input.consent_status === 'WITHDRAWN') {
      if (!isTimestamp(input.consent_at)) return fail('CONSENT_TIMESTAMP_REQUIRED', 'Consent timestamp is required');
    } else if (input.consent_at !== '' && input.consent_at !== null && input.consent_at !== undefined) {
      if (!isTimestamp(input.consent_at)) return fail('CONSENT_TIMESTAMP_INVALID', 'Consent timestamp is invalid');
    }
    var time = validateTimestamps(input);
    if (!time.ok) return time;
    return ok(copyFields(input, SHEETS.Registrations));
  }

  function validateDedupeRecord(input) {
    if (!isRecord(input)) return fail('DEDUPE_INVALID', 'Deduplication record is required');
    if (!validId(input.dedupe_id) || !validId(input.company_id)) return fail('DEDUPE_ID_INVALID', 'Deduplication or company ID is invalid');
    if (!oneOf(input.source, SOURCES)) return fail('DEDUPE_SOURCE_INVALID', 'Deduplication source is invalid');
    if (!isDigest(input.idempotency_key_hash) || !isDigest(input.request_fingerprint)) {
      return fail('DEDUPE_DIGEST_INVALID', 'Deduplication digests must be lowercase SHA-256 hex');
    }
    if (!oneOf(input.state, DEDUPE_STATES)) return fail('DEDUPE_STATE_INVALID', 'Deduplication state is invalid');
    if (input.state === 'PROCESSING' && input.registration_id) {
      return fail('DEDUPE_STATE_INCONSISTENT', 'Processing record cannot reference a completed registration');
    }
    if (input.state === 'COMPLETED' && !validId(input.registration_id)) {
      return fail('DEDUPE_REGISTRATION_REQUIRED', 'Completed record requires a registration ID');
    }
    var time = validateTimestamps(input);
    if (!time.ok) return time;
    return ok(copyFields(input, SHEETS.RequestDedupe));
  }

  function validateHeaders(sheetName, actualHeaders) {
    if (!Object.prototype.hasOwnProperty.call(SHEETS, sheetName) || !Array.isArray(actualHeaders)) {
      return fail('SCHEMA_SHEET_UNKNOWN', 'Required schema sheet is unknown');
    }
    var expected = SHEETS[sheetName];
    if (actualHeaders.length !== expected.length) return fail('SCHEMA_HEADER_MISMATCH', 'Sheet headers do not match schema');
    for (var i = 0; i < expected.length; i += 1) {
      if (actualHeaders[i] !== expected[i]) return fail('SCHEMA_HEADER_MISMATCH', 'Sheet headers do not match schema');
    }
    return ok(true);
  }

  function isAllowedRegistrationTransition(fromStatus, toStatus) {
    return oneOf(fromStatus, REGISTRATION_STATUSES) &&
      oneOf(toStatus, TRANSITIONS[fromStatus] || []);
  }

  function getSchemaDefinition() {
    var result = { version: SCHEMA_VERSION, sheets: {} };
    Object.keys(SHEETS).forEach(function (name) {
      result.sheets[name] = SHEETS[name].slice();
    });
    return result;
  }

  function validateTimestamps(input) {
    if (!isTimestamp(input.created_at) || !isTimestamp(input.updated_at)) {
      return fail('TIMESTAMP_INVALID', 'Creation and update timestamps must be UTC ISO-8601');
    }
    if (Date.parse(input.updated_at) < Date.parse(input.created_at)) {
      return fail('TIMESTAMP_ORDER_INVALID', 'Update timestamp cannot precede creation timestamp');
    }
    return ok(true);
  }

  function isTimestamp(value) {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    return !isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  }

  function isDigest(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  function validId(value) {
    return validText(value, 128, false) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
  }

  function validText(value, max, allowWhitespaceOnly) {
    if (typeof value !== 'string' || value.length > max) return false;
    if (!allowWhitespaceOnly && !value.trim()) return false;
    return true;
  }

  function oneOf(value, values) {
    return typeof value === 'string' && values.indexOf(value) !== -1;
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function copyFields(input, fields) {
    var output = {};
    fields.forEach(function (field) {
      output[field] = input[field] === undefined || input[field] === null ? '' : input[field];
    });
    return output;
  }

  function fail(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  function ok(value) {
    return { ok: true, value: value };
  }

  return {
    getSchemaDefinition: getSchemaDefinition,
    validateCompany: validateCompany,
    validateMembership: validateMembership,
    validateRegistration: validateRegistration,
    validateDedupeRecord: validateDedupeRecord,
    validateHeaders: validateHeaders,
    isAllowedRegistrationTransition: isAllowedRegistrationTransition
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReclaimDataContract;
}
