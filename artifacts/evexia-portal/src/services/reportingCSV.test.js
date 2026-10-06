import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.BroadcastChannel = undefined;
const { csvCell, reportCSV, REPORT_COLUMNS, downloadReportingCSV } = await import('./reportingCSV.js');

test('CSV quotes values and neutralizes formulas, whitespace prefixes and control characters', () => {
  for (const value of ['=SUM(1,2)', '+1', '-1', '@SUM(A1)', '  =cmd()', '\t@cmd', '\r=cmd', '\nformula', '\u0001=cmd']) {
    assert.equal(csvCell(value), `"\'${value.replaceAll('"', '""')}"`);
  }
  assert.equal(csvCell('a,"b"\r\nc'), '"a,""b""\r\nc"');
});

test('activity CSV forwards whole-result search and filters, rechecks authorization and honors cancellation', async () => {
  const auth = await import('../auth/adminSession.js');
  const user = { id: 'csv-synthetic-user', email: 'csv@example.test', system_role: 'super_admin', permissions: ['admin.access'] };
  const calls = [];
  let cancelAtRecheck = false;
  let controller;
  globalThis.fetch = async (url) => {
    calls.push(url);
    let body;
    if (url.includes('/events/export')) body = {
      columns: REPORT_COLUMNS.events, rows: Array.from({ length: 28 }, () => REPORT_COLUMNS.events.map(() => 'safe')),
      row_count: 28, limit: 5000,
    };
    else if (url.endsWith('/summary')) {
      if (cancelAtRecheck) controller.abort();
      body = {};
    } else if (url.endsWith('/me')) body = user;
    else body = { access_token: 'csv-synthetic-memory-token', expires_in: 900 };
    return new Response(JSON.stringify(body));
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, work) => work() } } });
  let clicks = 0;
  globalThis.document = {
    createElement: () => ({ click: () => { clicks++; }, remove() {} }),
    body: { appendChild() {} },
  };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:synthetic-csv';
  URL.revokeObjectURL = () => {};
  try {
    await auth.loginAdmin(user.email, 'synthetic-password', false);
    const params = { q: 'Record created %_', user_id: user.id, start: '2030-02-02T00:00:00Z' };
    controller = new AbortController();
    assert.equal(await downloadReportingCSV('events', params, controller.signal), 28);
    assert.equal(clicks, 1);
    const query = new URL(calls.find((url) => url.includes('/events/export')), 'https://example.test').searchParams;
    assert.equal(query.get('q'), params.q);
    assert.equal(query.get('user_id'), user.id);
    assert.equal(query.has('offset'), false);
    assert.ok(calls.at(-1).endsWith('/summary'));
    cancelAtRecheck = true;
    controller = new AbortController();
    await assert.rejects(downloadReportingCSV('events', params, controller.signal), { name: 'AbortError' });
    assert.equal(clicks, 1);
  } finally {
    await auth.logoutAdmin();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    delete globalThis.document;
  }
});

test('export requires complete safe columns and bounded rows; empty exports retain headers', () => {
  for (const resource of ['sessions', 'events']) {
    const columns = REPORT_COLUMNS[resource];
    const empty = { columns, rows: [], row_count: 0, limit: 5000 };
    assert.equal(reportCSV(resource, empty), '\uFEFF' + columns.map(csvCell).join(',') + '\r\n');
    const row = columns.map(() => '=formula,"quoted"');
    assert.ok(reportCSV(resource, { ...empty, rows: [row], row_count: 1 }).includes('"\'=formula,""quoted"""'));
    for (const data of [
      { ...empty, columns: [...columns, 'session_id'] },
      { ...empty, row_count: 1 }, { ...empty, rows: [[]], row_count: 1 },
      { ...empty, limit: 100 }, { ...empty, rows: [columns.map(() => null)], row_count: 1 },
      { ...empty, rows: Array(5001).fill(columns), row_count: 5001 },
    ]) assert.throws(() => reportCSV(resource, data), /incomplete or invalid/);
  }
});

