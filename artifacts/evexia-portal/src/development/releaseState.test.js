import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { failureGuidance, knownFailure } from './failureGuidance.js';

test('normal mounting and session validation have no compatibility dependency', async () => {
  for (const file of ['../main.jsx', '../auth/adminSession.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /DevelopmentBoundary|releaseState|developmentBlocked|probeCompatibility|retryRelease/);
  }
});

test('Vite does not embed an access-gating compatibility contract at startup', async () => {
  const source = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /candidateIdentity|EVEXIA_DEVELOPMENT_CONTRACT|EVEXIA_DEVELOPMENT_GATE/);
});

test('unknown exceptions never become displayed diagnostics', () => {
  assert.equal(knownFailure('private exception text'), false);
  assert.deepEqual(failureGuidance('private exception text'), failureGuidance('unavailable'));
});
