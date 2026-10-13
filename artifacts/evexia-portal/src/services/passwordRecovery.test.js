import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryToken, requestRecovery, resetPassword, validateReset } from './passwordRecovery.js';

test('fragment tokens never require query storage; duplicates rejected', () => {
  assert.equal(recoveryToken('#token=one'), 'one');
  assert.equal(recoveryToken('#token=one&token=two'), '');
  assert.equal(recoveryToken(''), '');
  assert.equal(recoveryToken('#token=' + 'x'.repeat(2049)), '');
});
test('password length and confirmation', () => {
  assert.match(validateReset('short', 'short'), /12/);
  assert.match(validateReset('long enough password', 'different'), /match/);
  assert.equal(validateReset('long enough password', 'long enough password'), '');
});
test('request contract contains no token or password and reset matches backend', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return { ok: true, json: async () => ({ message: 'Done', identity_kind: 'mr' }) };
  };
  try {
    await requestRecovery(' fictional ', 'mr');
    await resetPassword('synthetic-token', 'long enough password');
    assert.deepEqual(JSON.parse(calls[0][1].body), { identifier: 'fictional', identity_kind: 'mr' });
    assert.deepEqual(JSON.parse(calls[1][1].body), { token: 'synthetic-token', new_password: 'long enough password' });
    assert.equal(calls[1][0], '/api/v1/auth/reset-password');
    assert.equal(calls[1][1].credentials, 'same-origin');
    assert.equal(calls[1][1].cache, 'no-store');
  } finally { globalThis.fetch = original; }
});
test('safe errors and invalid success responses', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [400, 429, 503]) {
      globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ detail: 'SECRET' }) });
      await assert.rejects(resetPassword('token', 'long enough password'), error => !error.message.includes('SECRET'));
    }
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ message: 'Reset' }) });
    await assert.rejects(resetPassword('token', 'long enough password'), /unexpected/);
    globalThis.fetch = async () => { throw new Error('internal secret'); };
    await assert.rejects(requestRecovery('fictional', 'admin'), /Unable to reach/);
  } finally { globalThis.fetch = original; }
});
