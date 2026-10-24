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
  [`components/admin/DoctorForm.jsx:${businessToday}`, 'Joining-date validation against the Kolkata business day, not display'],
  ['pages/admin/OpeningStockFormPage.jsx:parsed.toISOString()', 'Round-trip validation of a UTC calendar input, not display'],
  ...['sptOrdersDemo', 'lupinOrdersDemo', 'kitsOrdersDemo', 'immunotherapyDemo'].map((name) =>
    [`services/${name}.js:${businessDate}`, 'Existing business-date generation, not presentation']),
  ...['serverMRs', 'serverPatients'].map((name) =>
    [`services/${name}.js:${businessToday}`, 'Business-day validation; unchanged Kolkata boundary']),
  ...['sptOrdersDemo', 'lupinOrdersDemo', 'immunotherapyDemo', 'serverImmunotherapy'].map((name) =>
    [`services/${name}.js:(minor / 100n).toLocaleString('en-IN')`, 'Currency grouping, not a Date']),
  ["services/openingStock.js:BigInt(digits).toLocaleString('en-IN')", 'Exact integer currency grouping, not date presentation'],
  ["services/orderTransfers.js:max.toLocaleString()", 'Integer character-count error limit, not date presentation'],
  ["services/orderTransfers.js:new Intl.DateTimeFormat('en-US', { timeZone: c.timeZone })", 'Validate an explicitly saved IANA timezone without formatting a display date'],
  ['pages/admin/ActivityLogs.jsx:new Date(`${value}T00:00:00Z`).toISOString()', 'UTC input validation'],
  ['pages/admin/ActivityLogs.jsx:new Date(t + DAY).toISOString()', 'Canonical inclusive-end UTC API filter'],
  ['pages/admin/DownloadLogs.jsx:new Date(`${v}T00:00:00Z`).toISOString()', 'UTC input validation'],
  ["pages/admin/DownloadLogs.jsx:new Date(Date.parse(`${f.end}T00:00:00Z`) + DAY).toISOString()", 'Canonical inclusive-end UTC API filter'],
  ['pages/admin/EmailLogs.jsx:new Date(`${v}T00:00:00Z`).toISOString()', 'UTC input validation, not display'],
  ["pages/admin/EmailLogs.jsx:new Date(Date.parse(`${f.end}T00:00:00Z`) + DAY).toISOString()", 'Canonical inclusive-end UTC API filter, not display'],
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
      const timezoneValidationUsedAsFormatter = file === 'services/orderTransfers.js' &&
        name === 'Intl.DateTimeFormat' && ts.isPropertyAccessExpression(node.parent);
      if ((primitive || uiISO) && file !== 'services/datePresentation.js' &&
          (!approved.has(`${file}:${node.getText(source)}`) || timezoneValidationUsedAsFormatter)) add(`unapproved display primitive: ${name}`);
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
test('form business-day/input validation exceptions do not exempt date display', () => {
  assert.deepEqual(displayViolations(`const today = ${businessToday}.format(new Date());`, 'components/admin/DoctorForm.jsx'), []);
  assert.deepEqual(displayViolations('const valid = parsed.toISOString().slice(0,10) === value;', 'pages/admin/OpeningStockFormPage.jsx'), []);
  assert.equal(displayViolations('const view = <p>{value.toISOString()}</p>;', 'pages/admin/OpeningStockFormPage.jsx').length, 1);
  assert.equal(displayViolations('const view = new Intl.DateTimeFormat().format(value);', 'components/admin/DoctorForm.jsx').length, 1);
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
test('Opening Stock currency exception requires the exact reviewed file and expression', () => {
  const text = "const group = (digits) => BigInt(digits).toLocaleString('en-IN');";
  assert.deepEqual(displayViolations(text, 'services/openingStock.js'), []);
  for (const file of ['services/new.js', 'services/openingStockCopy.js', 'services/openingStock.jsx', 'pages/admin/OpeningStock.jsx']) {
    const violations = displayViolations(text, file);
    assert.equal(violations.length, 1, file);
    assert.match(violations[0], /unapproved display primitive/);
  }
  for (const expression of [
    "BigInt(digits).toLocaleString('en-US')",
    'BigInt(digits).toLocaleString()',
    "BigInt(digits).toLocaleString('en-IN', { useGrouping: true })",
    "BigInt(otherDigits).toLocaleString('en-IN')",
    "Number(digits).toLocaleString('en-IN')",
  ]) {
    const violations = displayViolations(`const group = (digits) => ${expression};`, 'services/openingStock.js');
    assert.equal(violations.length, 1, expression);
    assert.match(violations[0], /unapproved display primitive/);
  }
});
test('Email Logs UTC exceptions permit only exact machine-filter expressions, never display formatting', () => {
  const expressions = [
    'new Date(`${v}T00:00:00Z`).toISOString()',
    'new Date(Date.parse(`${f.end}T00:00:00Z`) + DAY).toISOString()',
  ];
  for (const expression of expressions) {
    assert.deepEqual(displayViolations(`const filter = ${expression};`, 'pages/admin/EmailLogs.jsx'), []);
    assert.equal(displayViolations(`const filter = ${expression};`, 'pages/admin/NewEmailLogs.jsx').length, 1);
  }
  for (const expression of ['new Date(value).toISOString()', 'new Date(value).toLocaleString()']) {
    assert.equal(displayViolations(`const display = ${expression};`, 'pages/admin/EmailLogs.jsx').length, 1);
  }
});
test('Transfer numeric and timezone validation exceptions stay expression-scoped', () => {
  assert.deepEqual(displayViolations("max.toLocaleString()", 'services/orderTransfers.js'), []);
  assert.deepEqual(displayViolations("new Intl.DateTimeFormat('en-US', { timeZone: c.timeZone })", 'services/orderTransfers.js'), []);
  assert.equal(displayViolations("new Date().toLocaleString()", 'services/orderTransfers.js').length, 1);
  assert.equal(displayViolations("max.toLocaleString()", 'services/unreviewed.js').length, 1);
  assert.equal(displayViolations("new Intl.DateTimeFormat('en-US', { timeZone: c.timeZone }).format(new Date())", 'services/orderTransfers.js').length, 1);
});

test('Opening Stock numeric exception does not exempt nearby date presentation', () => {
  const numeric = "const group = (digits) => BigInt(digits).toLocaleString('en-IN');";
  for (const [text, reason] of [
    ["const view = () => new Date(value).toLocaleString('en-IN');", /unapproved display primitive/],
    ["const view = () => new Date(value).toLocaleDateString('en-IN');", /unapproved display primitive/],
    ["const view = () => new Date(value).toLocaleTimeString('en-IN');", /unapproved display primitive/],
    ["const view = () => new Intl.DateTimeFormat('en-IN').format(value);", /unapproved display primitive/],
    ['const view = <p>{row.poDate}</p>;', /raw date in JSX/],
    ['const columns = [{ render: (row) => row.date }];', /raw date table renderer/],
  ]) {
    const violations = displayViolations(`${numeric}\n${text}`, 'services/openingStock.js');
    assert.equal(violations.length, 1, text);
    assert.match(violations[0], reason);
  }
  // UI ISO detection remains scoped to JSX/TSX files, not canonical service serialization.
  const violations = displayViolations('const view = <p>{new Date(value).toISOString()}</p>;', 'services/openingStock.jsx');
  assert.equal(violations.length, 1);
  assert.match(violations[0], /unapproved display primitive/);
});
