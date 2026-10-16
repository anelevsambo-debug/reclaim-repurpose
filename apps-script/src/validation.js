/**
 * RECLAIM & REPURPOSE – Pure validation module (Stage 1)
 *
 * Runs identically in Google Apps Script (V8) and Node.
 * Contains no Google service calls, no identity, no persistence.
 * Fail-closed: invalid input always returns a structured error.
 */

var ReclaimValidation = (function () {
  'use strict';

  var SUPPORTED_COUNTRIES = {
    BOTSWANA: { code: 'BW', currency: 'BWP', name: 'Botswana' },
    ESWATINI: { code: 'SZ', currency: 'SZL', name: 'Eswatini' }
  };

  var ORGANISATION_STATUSES = ['ACTIVE', 'INACTIVE', 'PENDING'];

  function validateCountry(countryKey) {
    if (typeof countryKey !== 'string' || !countryKey.trim()) {
      return fail('COUNTRY_REQUIRED', 'Country is required');
    }
    var key = countryKey.trim().toUpperCase();
    var country = SUPPORTED_COUNTRIES[key];
    if (!country) {
      return fail('COUNTRY_UNSUPPORTED', 'Country must be BOTSWANA or ESWATINI');
    }
    return ok(country);
  }

  function validateCurrency(currency, expectedCurrency) {
    if (typeof currency !== 'string' || !currency.trim()) {
      return fail('CURRENCY_REQUIRED', 'Currency is required');
    }
    var c = currency.trim().toUpperCase();
    if (c !== expectedCurrency) {
      return fail(
        'CURRENCY_MISMATCH',
        'Currency ' + c + ' does not match country currency ' + expectedCurrency
      );
    }
    return ok(c);
  }

  function validateMoney(amount) {
    if (typeof amount !== 'number' || !isFinite(amount)) {
      return fail('MONEY_INVALID', 'Amount must be a finite number');
    }
    if (amount < 0) {
      return fail('MONEY_NEGATIVE', 'Amount cannot be negative');
    }
    var rounded = Math.round(amount * 100) / 100;
    if (Math.abs(amount - rounded) > 1e-9) {
      return fail('MONEY_PRECISION', 'Amount may have at most 2 decimal places');
    }
    return ok(rounded);
  }

  function validateOrganisation(input) {
    if (!input || typeof input !== 'object') {
      return fail('ORGANISATION_REQUIRED', 'Organisation object is required');
    }

    if (typeof input.name !== 'string' || !input.name.trim()) {
      return fail('ORGANISATION_NAME_REQUIRED', 'Organisation name is required');
    }
    var name = input.name.trim();
    if (name.length > 200) {
      return fail('ORGANISATION_NAME_TOO_LONG', 'Organisation name must be ≤ 200 characters');
    }

    var countryResult = validateCountry(input.country);
    if (!countryResult.ok) return countryResult;
    var country = countryResult.value;

    var currency = country.currency;
    if (input.currency !== undefined && input.currency !== null) {
      var currencyResult = validateCurrency(input.currency, country.currency);
      if (!currencyResult.ok) return currencyResult;
      currency = currencyResult.value;
    }

    var status = 'PENDING';
    if (input.status !== undefined && input.status !== null) {
      if (typeof input.status !== 'string') {
        return fail('ORGANISATION_STATUS_INVALID', 'Status must be a string');
      }
      status = input.status.trim().toUpperCase();
      if (ORGANISATION_STATUSES.indexOf(status) === -1) {
        return fail(
          'ORGANISATION_STATUS_UNSUPPORTED',
          'Status must be one of: ' + ORGANISATION_STATUSES.join(', ')
        );
      }
    }

    return ok({
      name: name,
      country: country.code,
      countryKey: Object.keys(SUPPORTED_COUNTRIES).find(function (k) {
        return SUPPORTED_COUNTRIES[k].code === country.code;
      }),
      currency: currency,
      status: status
    });
  }

  function fail(code, message) {
    return {
      ok: false,
      error: {
        code: code,
        message: message
      }
    };
  }

  function ok(value) {
    return { ok: true, value: value };
  }

  return {
    validateCountry: validateCountry,
    validateCurrency: validateCurrency,
    validateMoney: validateMoney,
    validateOrganisation: validateOrganisation,
    _test: {
      SUPPORTED_COUNTRIES: SUPPORTED_COUNTRIES,
      ORGANISATION_STATUSES: ORGANISATION_STATUSES
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReclaimValidation;
}
