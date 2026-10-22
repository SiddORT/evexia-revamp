import { reportingIdentityGuard, reportingRequest } from '../auth/adminSession.js';
import { recordLocalAction } from './localActivity.js';
import { downloadBlob } from './downloads.js';
import { captureExportPreferences } from './exportPreferences.js';
import { presentExportTable } from './exportDatePresentation.js';

export const REPORT_COLUMNS = {
  sessions: ['User', 'Role', 'Account state', 'State', 'Created / login (UTC)', 'Last refreshed (UTC)', 'Expires (UTC)', 'Revoked (UTC)', 'Persistent', 'Current session', 'Provenance'],
  events: ['Occurred (UTC)', 'User', 'Role', 'Account state', 'Action', 'Outcome', 'Reason', 'Resource type', 'Provenance'],
};

export function csvCell(value) {
  // Quote every cell, escape quotes/newlines, and neutralize spreadsheet formulas,
  // including those hidden behind leading whitespace or control characters.
  const text = /^[\s\u0000-\u0020]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
    ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportCSV(resource, data, preferences) {
  const columns = REPORT_COLUMNS[resource];
  if (!columns || JSON.stringify(data?.columns) !== JSON.stringify(columns) ||
      data.limit !== 5000 || !Array.isArray(data.rows) ||
      data.row_count !== data.rows.length || data.rows.length > data.limit ||
      data.rows.some((row) => !Array.isArray(row) || row.length !== columns.length || row.some((cell) => typeof cell !== 'string'))) {
    throw new Error('The export response was incomplete or invalid. No file was downloaded. Retry.');
  }
  const rows = presentExportTable(columns, data.rows,
    { timestampColumns: resource === 'sessions' ? [4, 5, 6, 7] : [0] }, preferences);
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export async function downloadReportingCSV(resource, params, signal) {
  const preferences = captureExportPreferences();
  const guard = reportingIdentityGuard();
  guard();
  const data = await reportingRequest(`${resource}/export`, params, { signal });
  const csv = reportCSV(resource, data, preferences);
  guard();
  // Recheck server authorization after fetching/decoding the snapshot, before
  // releasing any data to the browser's download manager.
  await reportingRequest('summary', {}, { signal });
  signal?.throwIfAborted();
  guard();
  await downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `evexia-${resource}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
    { source: resource === 'events' ? 'activity' : 'sessions', kind: 'export', format: 'CSV' }, { guard, signal });
  recordLocalAction('activity_logs', 'exported');
  return data.row_count;
}
