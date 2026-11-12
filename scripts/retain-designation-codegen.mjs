// Offline code generation post-processing. Preserve unrelated handwritten
// refinements after Orval regeneration of the designation-only contract.
// Baseline must be a known clean pre-generation source revision.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const baseline = process.argv[2];
if (!baseline) throw new Error('Supply the clean pre-generation Git revision.');
const roots = ['lib/api-client-react/src/generated/', 'lib/api-zod/src/generated/'];
const paths = execFileSync('git', ['diff', '--name-only', baseline, '--', ...roots], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

function declarations(source) {
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true);
  return tree.statements.map((statement) => {
    const name = statement.name?.text || statement.declarationList?.declarations[0]?.name?.text;
    return {
      name,
      // Orval emits both a type alias and a constant for each enum name.
      key: `${statement.kind}:${name}`,
      start: statement.getStart(tree),
      end: statement.end,
      text: source.slice(statement.getStart(tree), statement.end),
    };
  });
}

for (const path of paths) {
  const previous = execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const generated = fs.readFileSync(path, 'utf8');
  const oldStatements = declarations(previous);
  const newStatements = declarations(generated).filter(({ name }) => /designation/i.test(name || ''));
  const updates = new Map(newStatements.map((statement) => [statement.key, statement]));
  const edits = oldStatements.filter(({ key }) => updates.has(key)).map((statement) => ({
    ...statement, text: updates.get(statement.key).text,
  }));
  const oldNames = new Set(oldStatements.map(({ key }) => key));
  const additions = newStatements.filter(({ key }) => !oldNames.has(key));
  // New default literals precede their consumers and cannot cause a TDZ.
  if (additions.length) {
    const firstExport = oldStatements.find(({ name }) => name);
    edits.push({ start: firstExport.start, end: firstExport.start,
      text: additions.map(({ text }) => text).join('\n') + '\n\n' });
  }
  let output = previous;
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  fs.writeFileSync(path, output);
}
