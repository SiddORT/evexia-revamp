import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../src/', import.meta.url);
// Reviewed, expression-specific exceptions. No whole service/directory exemption.
const businessDate = "new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })";
const businessToday = "new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })";
const approved = new Map([
  ...['sptOrdersDemo', 'lupinOrdersDemo', 'kitsOrdersDemo', 'immunotherapyDemo'].map((name) =>
    [`services/${name}.js:${businessDate}`, 'Existing business-date generation, not presentation']),
  ...['serverMRs', 'serverPatients'].map((name) =>
    [`services/${name}.js:${businessToday}`, 'Business-day validation; unchanged Kolkata boundary']),
  ...['sptOrdersDemo', 'lupinOrdersDemo', 'immunotherapyDemo'].map((name) =>
    [`services/${name}.js:(minor / 100n).toLocaleString('en-IN')`, 'Currency grouping, not a Date']),
  ['pages/admin/ActivityLogs.jsx:new Date(`${value}T00:00:00Z`).toISOString()', 'UTC input validation'],
  ['pages/admin/ActivityLogs.jsx:new Date(t + DAY).toISOString()', 'Canonical inclusive-end UTC API filter'],
  ['pages/admin/DownloadLogs.jsx:new Date(`${v}T00:00:00Z`).toISOString()', 'UTC input validation'],
  ["pages/admin/DownloadLogs.jsx:new Date(Date.parse(`${f.end}T00:00:00Z`) + DAY).toISOString()", 'Canonical inclusive-end UTC API filter'],
]);
const dateProperty = /^(?:date|poDate|expectedDate|receivedDate|expiryDate|dateOfBirth|dateOfJoining|createdAt|updatedAt|deletedAt|expiresAt|created_at|updated_at|revoked_at|expires_at|last_refreshed_at|refreshed_at|verified_at|challenge_expires_at|verification_expires_at)$/;
export function displayViolations(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  const errors = [];
  function raw(expression) {
    if (!expression) return false;
    if (ts.isPropertyAccessExpression(expression)) return dateProperty.test(expression.name.text) && !/^(?:errors?|err)\b/.test(expression.expression.getText(source));
    if (ts.isParenthesizedExpression(expression)) return raw(expression.expression);
    if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) return raw(expression.left) || raw(expression.right);
    if (ts.isTemplateExpression(expression)) return expression.templateSpans.some((span) => raw(span.expression));
    return false;
  }
  function visit(node) {
    const add = (reason) => errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${reason}`);
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = node.expression.getText(source);
      const primitive = /(?:toLocale(?:DateString|TimeString|String)|DateTimeFormat|toDateString|toTimeString|toUTCString|toGMTString)$/.test(name);
      const uiISO = file.endsWith('x') && /toISOString$/.test(name);
      if ((primitive || uiISO) && file !== 'services/datePresentation.js' && !approved.has(`${file}:${node.getText(source)}`)) add(`unapproved display primitive: ${name}`);
    }
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && raw(node.expression)) add('raw date in JSX; use a shared formatter');
    if (ts.isArrowFunction(node) && raw(node.body) && node.parent.getText(source).startsWith('render:')) add('raw date table renderer');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}
test('portal display formatting uses the shared contract, with narrowly reviewed machine-output exceptions', () => {
  const violations = [];
  function scan(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(prefix, entry.name);
      const absolute = new URL(file, root);
      if (entry.isDirectory()) scan(absolute, `${file}/`);
      else if (/\.[jt]sx?$/.test(file) && !/\.test\./.test(file)) violations.push(...displayViolations(fs.readFileSync(absolute, 'utf8'), file));
    }
  }
  scan(root);
  assert.deepEqual(violations, []);
});
test('guard rejects newly introduced locale, ISO display, raw JSX and raw table bypasses', () => {
  for (const text of [
    'const view = () => new Date(value).toLocaleString();',
    'const view = () => new Intl.DateTimeFormat("en-US").format(value);',
    'const view = <p>{row.poDate}</p>;',
    'const view = <p>{row.created_at || "—"}</p>;',
    'const view = <p>{`${row.date}`}</p>;',
    'const columns = [{ render: (row) => row.date }];',
    'const view = <p>{new Date(value).toISOString()}</p>;',
  ]) assert.ok(displayViolations(text, 'pages/new.jsx').length, text);
  assert.deepEqual(displayViolations('const input = <input type="date" value={row.date} min={row.poDate} />; const time = <time dateTime={row.createdAt}>{formatAdminTimestamp(row.createdAt)}</time>;', 'pages/new.jsx'), []);
});
