import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.BroadcastChannel = undefined;
const { csvCell, reportCSV, REPORT_COLUMNS } = await import('./reportingCSV.js');

test('CSV quotes values and neutralizes formulas, whitespace prefixes and control characters', () => {
  for (const value of ['=SUM(1,2)', '+1', '-1', '@SUM(A1)', '  =cmd()', '\t@cmd', '\r=cmd', '\nformula', '\u0001=cmd']) {
    assert.equal(csvCell(value), `"\'${value.replaceAll('"', '""')}"`);
  }
  assert.equal(csvCell('a,"b"\r\nc'), '"a,""b""\r\nc"');
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

