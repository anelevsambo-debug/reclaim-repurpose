/**
 * RECLAIM & REPURPOSE — server-side Google Sheets repository (Stage 3).
 *
 * This module creates no public web endpoint. Callers must be internal server
 * code and must pass a principal produced by a future verified identity adapter.
 * Membership is always reloaded from the authoritative workbook.
 *
 * All spreadsheet, lock, clock, ID, and digest dependencies are injectable so
 * Node tests can use explicit fakes. Fakes are not proof of live Apps Script.
 */
var ReclaimSheetsRepository = (function () {
  'use strict';

  var LOCK_TIMEOUT_MS = 10000;
  var SCHEMA_VERSION = '1';
  var ALLOWED_REGISTRATION_INPUTS = [
    'customer_name', 'contact_identifier', 'country_code',
    'service_address', 'consent_status', 'consent_at'
  ];

  function createRepository(dependencies) {
    if (!dependencies || !dependencies.contract || !dependencies.authorization ||
        typeof dependencies.getSpreadsheetId !== 'function' ||
        typeof dependencies.openSpreadsheetById !== 'function' ||
        typeof dependencies.getScriptLock !== 'function' ||
        typeof dependencies.newId !== 'function' ||
        typeof dependencies.now !== 'function' ||
        typeof dependencies.sha256 !== 'function') {
      throw new Error('Repository dependencies are incomplete');
    }

    function createRegistration(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return failure('REQUEST_INVALID', 'Registration request is invalid');
      }
      var principal = request.principal;
      if (!principal || typeof principal !== 'object' || principal.authenticated !== true ||
          (principal.provider !== 'GOOGLE' && principal.provider !== 'WHATSAPP') ||
          typeof principal.subject !== 'string' || !principal.subject.trim()) {
        return failure('IDENTITY_NOT_VERIFIED', 'A verified identity is required');
      }
      if (typeof request.targetCompanyId !== 'string' || !request.targetCompanyId.trim()) {
        return failure('COMPANY_REQUIRED', 'Company is required');
      }
      if (typeof request.idempotencyKey !== 'string' ||
          !request.idempotencyKey.trim() || request.idempotencyKey.length > 255) {
        return failure('IDEMPOTENCY_KEY_INVALID', 'A valid request key is required');
      }
      if (!isAllowedSource(request.source)) {
        return failure('DEDUPE_SOURCE_INVALID', 'Request source is unsupported');
      }
      var inputResult = validateRegistrationInput(request.registration);
      if (!inputResult.ok) return inputResult;

      var lock;
      var locked = false;
      try {
        lock = dependencies.getScriptLock();
        lock.waitLock(LOCK_TIMEOUT_MS);
        locked = true;

        var workbook = openConfiguredWorkbook();
        verifySchema(workbook);
        var companyRows = readRows(workbook, 'Companies');
        var memberRows = readRows(workbook, 'CompanyMembers');
        var registrationRows = readRows(workbook, 'Registrations');
        var dedupeRows = readRows(workbook, 'RequestDedupe');

        var companyMatches = companyRows.filter(function (row) {
          return row.record.company_id === request.targetCompanyId;
        });
        if (companyMatches.length !== 1) {
          return failure('COMPANY_NOT_FOUND_OR_AMBIGUOUS', 'Company could not be verified');
        }
        var companyResult = dependencies.contract.validateCompany(companyMatches[0].record);
        if (!companyResult.ok || companyResult.value.status !== 'ACTIVE') {
          return failure('COMPANY_NOT_ACTIVE', 'Company is not active');
        }

        var memberMatches = memberRows.filter(function (row) {
          return row.record.company_id === request.targetCompanyId &&
            row.record.identity_provider === principal.provider &&
            row.record.provider_subject === principal.subject;
        });
        if (memberMatches.length !== 1) {
          return failure('MEMBERSHIP_NOT_UNIQUE', 'Active company membership could not be verified');
        }
        var memberResult = dependencies.contract.validateMembership(memberMatches[0].record);
        if (!memberResult.ok) return failure('MEMBERSHIP_INVALID', 'Company membership could not be verified');

        var membership = {
          subject: memberResult.value.provider_subject,
          companyId: memberResult.value.company_id,
          role: memberResult.value.role,
          status: memberResult.value.status
        };
        var auth = dependencies.authorization.authorizeCompanyAction({
          principal: principal,
          membership: membership,
          targetCompanyId: request.targetCompanyId,
          action: 'REGISTRATION_CREATE'
        });
        if (!auth.ok) return failure(auth.error.code, auth.error.message);
        var authorizedCompanyId = auth.value.companyId;

        if (inputResult.value.country_code !== companyResult.value.country_code) {
          return failure('COUNTRY_COMPANY_MISMATCH', 'Registration country must match company country');
        }

        var createdAt = dependencies.now();
        var keyHash = dependencies.sha256(
          authorizedCompanyId + '\n' + request.source + '\n' + request.idempotencyKey.trim()
        );
        var fingerprint = dependencies.sha256(JSON.stringify({
          company_id: authorizedCompanyId,
          customer_name: inputResult.value.customer_name,
          contact_identifier: inputResult.value.contact_identifier,
          country_code: inputResult.value.country_code,
          service_address: inputResult.value.service_address,
          consent_status: inputResult.value.consent_status,
          consent_at: inputResult.value.consent_at
        }));

        var duplicateRows = dedupeRows.filter(function (row) {
          return row.record.company_id === authorizedCompanyId &&
            row.record.source === request.source &&
            row.record.idempotency_key_hash === keyHash;
        });
        if (duplicateRows.length > 1) {
          return failure('DEDUPE_STATE_AMBIGUOUS', 'Request state requires restricted reconciliation');
        }

        var reservation;
        var reservationRow;
        var replayed = false;
        if (duplicateRows.length === 1) {
          reservationRow = duplicateRows[0];
          reservation = reservationRow.record;
          if (reservation.request_fingerprint !== fingerprint) {
            return failure('IDEMPOTENCY_CONFLICT', 'Request key was already used with different input');
          }
          replayed = true;
          if (reservation.state === 'COMPLETED') {
            var completed = findRegistration(registrationRows, reservation.registration_id, authorizedCompanyId);
            if (!completed) return failure('PERSISTENCE_INTEGRITY_ERROR', 'Stored request state requires reconciliation');
            return success(reservation.registration_id, completed.status, true);
          }
          var existingRegistration = findRegistration(registrationRows, reservation.registration_id, authorizedCompanyId);
          if (existingRegistration) {
            reservation.state = 'COMPLETED';
            reservation.updated_at = dependencies.now();
            reservationRow.record = reservation;
            updateRecord(workbook, 'RequestDedupe', reservationRow, reservation);
            return success(reservation.registration_id, existingRegistration.status, true);
          }
        } else {
          reservation = {
            dedupe_id: dependencies.newId(),
            company_id: authorizedCompanyId,
            source: request.source,
            idempotency_key_hash: keyHash,
            request_fingerprint: fingerprint,
            state: 'PROCESSING',
            registration_id: dependencies.newId(),
            created_at: createdAt,
            updated_at: createdAt
          };
          var reservationValidation = dependencies.contract.validateDedupeRecord(reservation);
          if (!reservationValidation.ok) return failure('DEDUPE_RECORD_INVALID', 'Request could not be reserved');
          appendRecord(workbook, 'RequestDedupe', reservationValidation.value);
          reservation = reservationValidation.value;
          reservationRow = { rowNumber: null, record: reservation };
        }

        var registration = {
          registration_id: reservation.registration_id,
          company_id: authorizedCompanyId,
          customer_name: inputResult.value.customer_name,
          contact_identifier: inputResult.value.contact_identifier,
          country_code: inputResult.value.country_code,
          service_address: inputResult.value.service_address,
          status: 'PENDING',
          consent_status: inputResult.value.consent_status,
          consent_at: inputResult.value.consent_at,
          created_at: reservation.created_at,
          updated_at: dependencies.now()
        };
        var registrationValidation = dependencies.contract.validateRegistration(registration);
        if (!registrationValidation.ok) return failure('REGISTRATION_RECORD_INVALID', 'Registration could not be saved');

        var existingById = findRegistration(registrationRows, registration.registration_id, authorizedCompanyId);
        if (!existingById) {
          appendRecord(workbook, 'Registrations', registrationValidation.value);
        } else {
          registration = existingById;
        }

        reservation.state = 'COMPLETED';
        reservation.registration_id = registration.registration_id;
        reservation.updated_at = dependencies.now();
        var completedValidation = dependencies.contract.validateDedupeRecord(reservation);
        if (!completedValidation.ok) return failure('DEDUPE_COMPLETION_INVALID', 'Registration requires reconciliation');
        if (reservationRow.rowNumber === null) {
          var refreshedDedupe = readRows(workbook, 'RequestDedupe');
          var persisted = refreshedDedupe.filter(function (row) {
            return row.record.dedupe_id === reservation.dedupe_id;
          });
          if (persisted.length !== 1) return failure('PERSISTENCE_INTEGRITY_ERROR', 'Registration requires reconciliation');
          updateRecord(workbook, 'RequestDedupe', persisted[0], completedValidation.value);
        } else {
          updateRecord(workbook, 'RequestDedupe', reservationRow, completedValidation.value);
        }
        return success(registration.registration_id, registration.status, replayed);
      } catch (error) {
        // Do not return raw Google service errors or spreadsheet content.
        return failure('PERSISTENCE_OPERATION_FAILED', 'The request could not be completed safely');
      } finally {
        if (locked && lock) {
          try { lock.releaseLock(); } catch (ignored) { /* safe failure; no raw details returned */ }
        }
      }
    }

    function listRegistrations(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return failure('REQUEST_INVALID', 'Registration query is invalid');
      }
      var principal = request.principal;
      if (!principal || typeof principal !== 'object' || principal.authenticated !== true ||
          (principal.provider !== 'GOOGLE' && principal.provider !== 'WHATSAPP') ||
          typeof principal.subject !== 'string' || !principal.subject.trim()) {
        return failure('IDENTITY_NOT_VERIFIED', 'A verified identity is required');
      }
      if (typeof request.targetCompanyId !== 'string' || !request.targetCompanyId.trim()) {
        return failure('COMPANY_REQUIRED', 'Company is required');
      }
      var lock;
      var locked = false;
      try {
        lock = dependencies.getScriptLock();
        lock.waitLock(LOCK_TIMEOUT_MS);
        locked = true;
        var workbook = openConfiguredWorkbook();
        verifySchema(workbook);
        var companies = readRows(workbook, 'Companies').filter(function (row) {
          return row.record.company_id === request.targetCompanyId;
        });
        var members = readRows(workbook, 'CompanyMembers').filter(function (row) {
          return row.record.company_id === request.targetCompanyId &&
            row.record.identity_provider === principal.provider &&
            row.record.provider_subject === principal.subject;
        });
        if (companies.length !== 1 || members.length !== 1) {
          return failure('MEMBERSHIP_NOT_UNIQUE', 'Active company membership could not be verified');
        }
        var company = dependencies.contract.validateCompany(companies[0].record);
        var member = dependencies.contract.validateMembership(members[0].record);
        if (!company.ok || company.value.status !== 'ACTIVE' || !member.ok) {
          return failure('COMPANY_OR_MEMBERSHIP_INVALID', 'Company access could not be verified');
        }
        var auth = dependencies.authorization.authorizeCompanyAction({
          principal: principal,
          membership: {
            subject: member.value.provider_subject,
            companyId: member.value.company_id,
            role: member.value.role,
            status: member.value.status
          },
          targetCompanyId: request.targetCompanyId,
          action: 'REGISTRATION_READ'
        });
        if (!auth.ok) return failure(auth.error.code, auth.error.message);
        var authorizedCompanyId = auth.value.companyId;
        var registrations = readRows(workbook, 'Registrations').filter(function (row) {
          return row.record.company_id === authorizedCompanyId;
        });
        var safeRows = [];
        for (var i = 0; i < registrations.length; i += 1) {
          var validated = dependencies.contract.validateRegistration(registrations[i].record);
          if (!validated.ok) return failure('PERSISTENCE_RECORD_INVALID', 'Stored registration data requires review');
          safeRows.push(validated.value);
        }
        return { ok: true, value: safeRows };
      } catch (error) {
        return failure('PERSISTENCE_OPERATION_FAILED', 'The request could not be completed safely');
      } finally {
        if (locked && lock) {
          try { lock.releaseLock(); } catch (ignored) { /* no raw error escapes */ }
        }
      }
    }

    function openConfiguredWorkbook() {
      var id = dependencies.getSpreadsheetId();
      if (typeof id !== 'string' || !id.trim() || id.length > 200 || /[\s/]/.test(id)) {
        throw new Error('Invalid trusted spreadsheet configuration');
      }
      return dependencies.openSpreadsheetById(id);
    }

    function verifySchema(workbook) {
      var metadata = readRows(workbook, '_Metadata');
      var versions = metadata.filter(function (row) { return row.record.key === 'schema_version'; });
      if (versions.length !== 1 || String(versions[0].record.value) !== SCHEMA_VERSION || metadata.length !== 1) {
        throw new Error('Workbook schema version is invalid');
      }
    }

    function readRows(workbook, sheetName) {
      var schema = dependencies.contract.getSchemaDefinition();
      var headers = schema.sheets[sheetName];
      if (!headers) throw new Error('Unknown schema sheet');
      var sheet = workbook.getSheetByName(sheetName);
      if (!sheet) throw new Error('Required sheet is missing');
      var lastRow = sheet.getLastRow();
      var lastColumn = sheet.getLastColumn();
      if (lastRow < 1 || lastColumn !== headers.length) throw new Error('Sheet dimensions do not match schema');
      var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
      var headerCheck = dependencies.contract.validateHeaders(sheetName, values[0].map(asText));
      if (!headerCheck.ok) throw new Error('Sheet headers do not match schema');
      var result = [];
      for (var r = 1; r < values.length; r += 1) {
        var allBlank = values[r].every(function (value) { return value === '' || value === null; });
        if (allBlank) continue;
        var record = {};
        for (var c = 0; c < headers.length; c += 1) record[headers[c]] = asText(values[r][c]);
        result.push({ rowNumber: r + 1, record: record });
      }
      return result;
    }

    function appendRecord(workbook, sheetName, record) {
      var schema = dependencies.contract.getSchemaDefinition();
      var headers = schema.sheets[sheetName];
      var sheet = workbook.getSheetByName(sheetName);
      if (!sheet) throw new Error('Required sheet is missing');
      var rowNumber = Math.max(1, sheet.getLastRow()) + 1;
      var values = headers.map(function (header) { return safeCell(record[header]); });
      var range = sheet.getRange(rowNumber, 1, 1, headers.length);
      range.setNumberFormat('@');
      range.setValues([values]);
    }

    function updateRecord(workbook, sheetName, row, record) {
      if (!row || typeof row.rowNumber !== 'number' || row.rowNumber < 2) {
        throw new Error('Record row cannot be updated');
      }
      var headers = dependencies.contract.getSchemaDefinition().sheets[sheetName];
      var sheet = workbook.getSheetByName(sheetName);
      if (!sheet) throw new Error('Required sheet is missing');
      var range = sheet.getRange(row.rowNumber, 1, 1, headers.length);
      range.setNumberFormat('@');
      range.setValues([headers.map(function (header) { return safeCell(record[header]); })]);
    }

    function findRegistration(rows, registrationId, companyId) {
      var matches = rows.filter(function (row) {
        return row.record.registration_id === registrationId &&
          row.record.company_id === companyId;
      });
      if (matches.length !== 1) return null;
      return matches[0].record;
    }

    function validateRegistrationInput(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return failure('REGISTRATION_INPUT_INVALID', 'Registration details are invalid');
      }
      var keys = Object.keys(input);
      for (var i = 0; i < keys.length; i += 1) {
        if (ALLOWED_REGISTRATION_INPUTS.indexOf(keys[i]) === -1) {
          return failure('REGISTRATION_FIELD_UNSUPPORTED', 'Registration contains unsupported fields');
        }
      }
      var normalized = {
        registration_id: 'validation-only',
        company_id: 'validation-only',
        customer_name: input.customer_name === undefined || input.customer_name === null ? '' : input.customer_name,
        contact_identifier: input.contact_identifier,
        country_code: input.country_code,
        service_address: input.service_address === undefined || input.service_address === null ? '' : input.service_address,
        status: 'PENDING',
        consent_status: input.consent_status,
        consent_at: input.consent_at === undefined || input.consent_at === null ? '' : input.consent_at,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      };
      if (normalized.consent_status !== 'GRANTED' || !normalized.consent_at) {
        return failure('CONSENT_REQUIRED', 'Explicit consent is required before registration');
      }
      var validation = dependencies.contract.validateRegistration(normalized);
      if (!validation.ok) return failure(validation.error.code, validation.error.message);
      return { ok: true, value: {
        customer_name: validation.value.customer_name,
        contact_identifier: validation.value.contact_identifier,
        country_code: validation.value.country_code,
        service_address: validation.value.service_address,
        consent_status: validation.value.consent_status,
        consent_at: validation.value.consent_at
      } };
    }

    return {
      createRegistration: createRegistration,
      listRegistrations: listRegistrations
    };
  }

  function createAppsScriptRepository() {
    if (typeof PropertiesService === 'undefined' || typeof SpreadsheetApp === 'undefined' ||
        typeof LockService === 'undefined' || typeof Utilities === 'undefined') {
      throw new Error('Google Apps Script services are unavailable');
    }
    return createRepository({
      contract: ReclaimDataContract,
      authorization: ReclaimAuthorization,
      getSpreadsheetId: function () {
        return PropertiesService.getScriptProperties().getProperty('RECLAIM_SPREADSHEET_ID');
      },
      openSpreadsheetById: function (id) { return SpreadsheetApp.openById(id); },
      getScriptLock: function () { return LockService.getScriptLock(); },
      newId: function () { return Utilities.getUuid(); },
      now: function () { return new Date().toISOString(); },
      sha256: function (value) {
        var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
        return bytes.map(function (byte) {
          var unsigned = (byte + 256) % 256;
          return ('0' + unsigned.toString(16)).slice(-2);
        }).join('');
      }
    });
  }

  function asText(value) {
    if (value === null || value === undefined) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    return String(value);
  }

  function safeCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    // A leading apostrophe forces potentially executable spreadsheet text to remain text.
    if (/^\s*=/.test(text)) return "'" + text;
    return text;
  }

  function isAllowedSource(value) {
    return value === 'WHATSAPP' || value === 'INTERNAL';
  }

  function success(registrationId, status, replayed) {
    return { ok: true, value: { registration_id: registrationId, status: status, replayed: replayed } };
  }

  function failure(code, message) {
    return { ok: false, error: { code: code, message: message } };
  }

  return {
    createRepository: createRepository,
    createAppsScriptRepository: createAppsScriptRepository
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReclaimSheetsRepository;
}
