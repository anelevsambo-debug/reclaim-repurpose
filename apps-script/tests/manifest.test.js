'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Apps Script manifest – least privilege', () => {
  const manifestPath = path.join(__dirname, '..', 'appsscript.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  it('uses the V8 runtime and the project timezone', () => {
    assert.equal(manifest.runtimeVersion, 'V8');
    assert.equal(manifest.timeZone, 'Africa/Gaborone');
  });

  it('does not request unused OAuth scopes before integrations are implemented', () => {
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'oauthScopes'), false);
  });
});
