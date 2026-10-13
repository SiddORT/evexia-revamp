import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./run-authenticated-previews.sh', import.meta.url), 'utf8');
test('preview never invokes the production initialization wrapper', () => {
  assert.ok(!source.includes('scripts/initialize-api.sh'));
  assert.ok(source.includes('command.upgrade(config, SCHEMA_REVISION)'));
  assert.ok(!source.includes('upgrade head'));
  assert.ok(source.includes('python3 -B -m app.bootstrap'));
});
test('private database is forced before initialization, empty and graph checked', () => {
  const initialize = source.indexOf("<<'PY_PREVIEW_INITIALIZE'");
  assert.ok(source.indexOf('export DATABASE_URL=') < initialize);
  assert.ok(source.indexOf("listen_addresses=''") < initialize);
  for (const guard of ['url.database != "evexia_auth_preview_test"',
    'url.host not in (None, "")', 'url.query.get("host") != str(socket)',
    'not socket.is_dir()', 'socket.is_symlink()', 'get_table_names()',
    'get_heads() != [SCHEMA_REVISION]']) {
    assert.ok(source.includes(guard), guard);
  }
  assert.ok(source.indexOf('get_table_names()') < source.indexOf('command.upgrade'));
});
test('preview cannot send recovery mail using inherited operator secrets', () => {
  assert.ok(source.includes('export PASSWORD_RECOVERY_URL= SMTP_HOST= SMTP_USERNAME= SMTP_PASSWORD= SMTP_FROM='));
  assert.ok(source.includes('export SMTP_PORT=587 SMTP_IMPLICIT_TLS=false'));
});
