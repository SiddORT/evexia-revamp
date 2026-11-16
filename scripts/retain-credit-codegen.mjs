// Offline generator post-processing, not a check: keep unrelated reviewed
// declarations and imports exactly as they were before this scoped generation.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const baseline = process.argv[2];
if (!baseline) throw new Error('Supply the pre-generation source revision.');
const roots = ['lib/api-client-react/src/generated/', 'lib/api-zod/src/generated/'];
const paths = execFileSync('git', ['diff', '--name-only', baseline, '--', ...roots], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
function parse(source) {
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true);
  return tree.statements.map((statement) => {
    const name = statement.name?.text || statement.declarationList?.declarations[0]?.name?.text;
    return { statement, name, key: `${statement.kind}:${name}`, start: statement.getStart(tree),
      end: statement.end, text: source.slice(statement.getStart(tree), statement.end) };
  });
}
for (const path of paths) {
  const previous = execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  const generated = fs.readFileSync(path, 'utf8');
  const oldStatements = parse(previous), newStatements = parse(generated);
  const changed = newStatements.filter(({ name, text }) => /credit|settlement/i.test(name || '')
    || /\b(committedTargetCredits|creditRevision|ledgerCredited|ledgerPaid)\b/.test(text));
  const updates = new Map(changed.map(s => [s.key, s]));
  const edits = oldStatements.filter(s => updates.has(s.key)).map(s => ({ ...s, text: updates.get(s.key).text }));
  const oldNames = new Set(oldStatements.map(s => s.key));
  const additions = changed.filter(s => !oldNames.has(s.key)).map(s => s.text);
  // Generated endpoints need their new schema imports; don't replace reviewed
  // unrelated imports or drop historical custom types.
  const imports = new Set(oldStatements.flatMap(({ statement }) =>
    ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements.map(e => e.name.text) : []));
  for (const { statement } of newStatements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings
      || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    const names = statement.importClause.namedBindings.elements.filter(e => !imports.has(e.name.text))
      .filter(e => new RegExp(`\\b${e.name.text}\\b`).test([...additions, ...edits.map(x => x.text)].join('\n')));
    if (names.length) additions.unshift(`import ${statement.importClause.isTypeOnly ? 'type ' : ''}{ ${names.map(e => e.getText()).join(', ')} } from ${statement.moduleSpecifier.getText()};`);
  }
  if (additions.length) {
    // Hoisted generated literals must precede schema initializers.
    const first = oldStatements.find(s => !ts.isImportDeclaration(s.statement));
    edits.push({ start: first.start, end: first.start, text: additions.join('\n\n') + '\n\n' });
  }
  let output = previous;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start || b.end - a.end))
    output = output.slice(0, start) + text + output.slice(end);
  fs.writeFileSync(path, output);
}
