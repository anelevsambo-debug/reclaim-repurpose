'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Contract = require('../src/data-contract.js');
const Authorization = require('../src/authorization.js');
const Repository = require('../src/sheets-repository.js');

const CREATED = '2026-10-17T12:00:00.000Z';

function makeWorkbook(options = {}) {
  const definitions = Contract.getSchemaDefinition().sheets;
  const data = {};
  for (const [name, headers] of Object.entries(definitions)) {
    if (options.missingSheet === name) continue;
    data[name] = [headers.slice()];
  }
  data._Metadata.push(['schema_version', options.schemaVersion || '1']);
  data.Companies.push(['company-a', 'Company A', 'BW', 'ACTIVE', CREATED, CREATED]);
  data.Companies.push(['company-b', 'Company B', 'BW', 'ACTIVE', CREATED, CREATED]);
  data.CompanyMembers.push(['member-a', 'company-a', 'WHATSAPP', 'wa:111', 'COMPANY_ADMIN', 'ACTIVE', CREATED, CREATED]);
  data.CompanyMembers.push(['member-b', 'company-b', 'WHATSAPP', 'wa:222', 'COMPANY_ADMIN', 'ACTIVE', CREATED, CREATED]);

  const sheets = {};
  for (const [name, rows] of Object.entries(data)) {
    sheets[name] = {
      rows,
      failNextWrite: false,
      getLastRow() { return this.rows.length; },
      getLastColumn() { return this.rows[0].length; },
      getRange(row, column, numRows, numColumns) {
        const sheet = this;
        return {
          setNumberFormat() {},
          getValues() {
            return sheet.rows.slice(row - 1, row - 1 + numRows)
              .map(values => values.slice(column - 1, column - 1 + numColumns));
          },
          setValues(values) {
            if (sheet.failNextWrite) {
              sheet.failNextWrite = false;
              throw new Error('synthetic private spreadsheet failure');
            }
            for (let i = 0; i < values.length; i += 1) {
              sheet.rows[row - 1 + i] = values[i].slice();
            }
          }
        };
      }
    };
  }
  return {
    data,
    sheets,
    getSheetByName(name) { return sheets[name] || null; }
  };
}

function harness(options = {}) {
  const workbook = makeWorkbook(options);
  let id = 0;
  let releaseCount = 0;
  let waitCount = 0;
  const lock = {
    waitLock() {
      waitCount += 1;
      if (options.lockFails) throw new Error('synthetic lock timeout');
    },
    releaseLock() { releaseCount += 1; }
  };
  const repository = Repository.createRepository({
    contract: Contract,
    authorization: Authorization,
    getSpreadsheetId: () => options.spreadsheetId === undefined ? 'trusted-sheet-id' : options.spreadsheetId,
    openSpreadsheetById: () => {
      if (options.openFails) throw new Error('synthetic spreadsheet open failure');
      return workbook;
    },
    getScriptLock: () => lock,
    newId: () => 'generated-' + (++id),
    now: () => CREATED,
    sha256: value => crypto.createHash('sha256').update(value, 'utf8').digest('hex')
  });
  return { repository, workbook, lock, counts: () => ({ releaseCount, waitCount }) };
}

function createRequest(overrides = {}) {
  return {
    principal: { authenticated: true, provider: 'WHATSAPP', subject: 'wa:111' },
    targetCompanyId: 'company-a',
    source: 'WHATSAPP',
    idempotencyKey: 'event-001',
    registration: {
      customer_name: 'Synthetic Customer',
      contact_identifier: '+26771111111',
      country_code: 'BW',
      service_address: 'Synthetic address',
      consent_status: 'GRANTED',
      consent_at: CREATED
    },
    ...overrides
  };
}

function rows(workbook, name) {
  return workbook.sheets[name].rows.slice(1);
}

describe('ReclaimSheetsRepository — registration writes', () => {
  it('creates one registration and returns only a minimal result', () => {
    const h = harness();
    const result = h.repository.createRegistration(createRequest());
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, {
      registration_id: 'generated-2',
      status: 'PENDING',
      replayed: false
    });
    assert.equal(rows(h.workbook, 'Registrations').length, 1);
    assert.equal(rows(h.workbook, 'RequestDedupe').length, 1);
    assert.equal(rows(h.workbook, 'RequestDedupe')[0][5], 'COMPLETED');
    assert.equal(JSON.stringify(result).includes('+26771111111'), false);
    assert.deepEqual(h.counts(), { releaseCount: 1, waitCount: 1 });
  });

  it('returns the existing registration for a repeated event without adding rows', () => {
    const h = harness();
    const first = h.repository.createRegistration(createRequest());
    const second = h.repository.createRegistration(createRequest());
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.value.registration_id, first.value.registration_id);
    assert.equal(second.value.replayed, true);
    assert.equal(rows(h.workbook, 'Registrations').length, 1);
    assert.equal(rows(h.workbook, 'RequestDedupe').length, 1);
    assert.equal(h.counts().releaseCount, 2);
  });

  it('rejects reuse of the same event key with different registration data', () => {
    const h = harness();
    assert.equal(h.repository.createRegistration(createRequest()).ok, true);
    const conflict = h.repository.createRegistration(createRequest({
      registration: {
        customer_name: 'Different Customer',
        contact_identifier: '+26772222222',
        country_code: 'BW',
        service_address: '',
        consent_status: 'GRANTED',
        consent_at: CREATED
      }
    }));
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(rows(h.workbook, 'Registrations').length, 1);
  });

  it('resumes a processing reservation after a registration write failure without duplicating', () => {
    const h = harness();
    h.workbook.sheets.Registrations.failNextWrite = true;
    const failed = h.repository.createRegistration(createRequest());
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, 'PERSISTENCE_OPERATION_FAILED');
    assert.equal(rows(h.workbook, 'Registrations').length, 0);
    assert.equal(rows(h.workbook, 'RequestDedupe').length, 1);
    assert.equal(rows(h.workbook, 'RequestDedupe')[0][5], 'PROCESSING');

    const retried = h.repository.createRegistration(createRequest());
    assert.equal(retried.ok, true);
    assert.equal(retried.value.replayed, true);
    assert.equal(rows(h.workbook, 'Registrations').length, 1);
    assert.equal(rows(h.workbook, 'RequestDedupe').length, 1);
    assert.equal(rows(h.workbook, 'RequestDedupe')[0][5], 'COMPLETED');
  });

  it('rejects registration without explicit consent before writing any row', () => {
    const h = harness();
    const result = h.repository.createRegistration(createRequest({
      registration: {
        customer_name: '',
        contact_identifier: '+26771111111',
        country_code: 'BW',
        service_address: '',
        consent_status: 'PENDING',
        consent_at: ''
      }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CONSENT_REQUIRED');
    assert.equal(rows(h.workbook, 'Registrations').length, 0);
    assert.equal(rows(h.workbook, 'RequestDedupe').length, 0);
  });

  it('rejects client attempts to supply authoritative fields', () => {
    const h = harness();
    const result = h.repository.createRegistration(createRequest({
      registration: {
        registration_id: 'attacker-chosen',
        company_id: 'company-b',
        contact_identifier: '+26771111111',
        country_code: 'BW',
        consent_status: 'GRANTED',
        consent_at: CREATED
      }
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'REGISTRATION_FIELD_UNSUPPORTED');
    assert.equal(rows(h.workbook, 'Registrations').length, 0);
  });

  it('rejects an unauthorised or cross-company request without reading out registration data', () => {
    const h = harness();
    const result = h.repository.createRegistration(createRequest({
      targetCompanyId: 'company-b'
    }));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'MEMBERSHIP_NOT_UNIQUE');
    assert.equal(rows(h.workbook, 'Registrations').length, 0);
    assert.equal(JSON.stringify(result).includes('+267'), false);
  });

  it('rejects an inactive membership', () => {
    const h = harness();
    h.workbook.sheets.CompanyMembers.rows[1][5] = 'SUSPENDED';
    const result = h.repository.createRegistration(createRequest());
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'COMPANY_MEMBERSHIP_INACTIVE');
    assert.equal(rows(h.workbook, 'Registrations').length, 0);
  });

  it('rejects a country mismatch and an unsupported source', () => {
    const h = harness();
    const mismatch = h.repository.createRegistration(createRequest({
      registration: {
        customer_name: '',
        contact_identifier: '+26771111111',
        country_code: 'SZ',
        service_address: '',
        consent_status: 'GRANTED',
        consent_at: CREATED
      }
    }));
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.error.code, 'COUNTRY_COMPANY_MISMATCH');

    const source = h.repository.createRegistration(createRequest({ source: 'UNTRUSTED' }));
    assert.equal(source.ok, false);
    assert.equal(source.error.code, 'DEDUPE_SOURCE_INVALID');
  });
});

describe('ReclaimSheetsRepository — fail-closed configuration and read isolation', () => {
  it('fails closed on missing workbook configuration, missing tabs, and schema mismatch', () => {
    const missingConfig = harness({ spreadsheetId: '' });
    assert.equal(missingConfig.repository.createRegistration(createRequest()).error.code, 'PERSISTENCE_OPERATION_FAILED');

    const missingTab = harness({ missingSheet: 'Registrations' });
    assert.equal(missingTab.repository.createRegistration(createRequest()).error.code, 'PERSISTENCE_OPERATION_FAILED');

    const badVersion = harness({ schemaVersion: '99' });
    assert.equal(badVersion.repository.createRegistration(createRequest()).error.code, 'PERSISTENCE_OPERATION_FAILED');
  });

  it('releases the lock after failures and denies access when lock acquisition fails', () => {
    const h = harness({ openFails: true });
    assert.equal(h.repository.createRegistration(createRequest()).ok, false);
    assert.equal(h.counts().releaseCount, 1);

    const lockFailure = harness({ lockFails: true });
    assert.equal(lockFailure.repository.createRegistration(createRequest()).ok, false);
    assert.equal(lockFailure.counts().releaseCount, 0);
    assert.equal(rows(lockFailure.workbook, 'Registrations').length, 0);
    assert.equal(rows(lockFailure.workbook, 'RequestDedupe').length, 0);
  });

  it('lists only records belonging to the authorised company', () => {
    const h = harness();
    const created = h.repository.createRegistration(createRequest());
    assert.equal(created.ok, true);
    h.workbook.sheets.Registrations.rows.push([
      'foreign-reg', 'company-b', 'Other Customer', '+26779999999', 'BW', '',
      'PENDING', 'GRANTED', CREATED, CREATED, CREATED
    ]);

    const allowed = h.repository.listRegistrations({
      principal: { authenticated: true, provider: 'WHATSAPP', subject: 'wa:111' },
      targetCompanyId: 'company-a'
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.value.length, 1);
    assert.equal(allowed.value[0].company_id, 'company-a');

    const denied = h.repository.listRegistrations({
      principal: { authenticated: true, provider: 'WHATSAPP', subject: 'wa:111' },
      targetCompanyId: 'company-b'
    });
    assert.equal(denied.ok, false);
    assert.equal(JSON.stringify(denied).includes('+26779999999'), false);
  });

  it('does not expose raw spreadsheet exceptions', () => {
    const h = harness({ openFails: true });
    const result = h.repository.createRegistration(createRequest());
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'PERSISTENCE_OPERATION_FAILED',
        message: 'The request could not be completed safely'
      }
    });
    assert.equal(JSON.stringify(result).includes('synthetic private spreadsheet failure'), false);
  });

  it('fails closed when a persisted idempotency reservation is malformed', () => {
    const h = harness();
    h.workbook.sheets.Registrations.failNextWrite = true;
    assert.equal(h.repository.createRegistration(createRequest()).ok, false);
    h.workbook.sheets.RequestDedupe.rows[1][5] = 'CORRUPT';
    const retry = h.repository.createRegistration(createRequest());
    assert.equal(retry.ok, false);
    assert.equal(retry.error.code, 'DEDUPE_RECORD_INVALID');
    assert.equal(rows(h.workbook, 'Registrations').length, 0);
  });

  it('does not reuse a registration ID found in another company during recovery', () => {
    const h = harness();
    h.workbook.sheets.Registrations.failNextWrite = true;
    assert.equal(h.repository.createRegistration(createRequest()).ok, false);
    const reservation = rows(h.workbook, 'RequestDedupe')[0];
    const reservedRegistrationId = reservation[6];
    h.workbook.sheets.Registrations.rows.push([
      reservedRegistrationId, 'company-b', 'Other Customer', '+26779999999', 'BW', '',
      'PENDING', 'GRANTED', CREATED, CREATED, CREATED
    ]);
    const retry = h.repository.createRegistration(createRequest());
    assert.equal(retry.ok, false);
    assert.equal(retry.error.code, 'PERSISTENCE_OPERATION_FAILED');
    assert.equal(rows(h.workbook, 'Registrations').length, 1);
    assert.equal(rows(h.workbook, 'Registrations')[0][0], reservedRegistrationId);
    assert.equal(rows(h.workbook, 'Registrations')[0][1], 'company-b');
  });

});
