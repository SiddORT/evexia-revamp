// Orval can emit response-bound constants after schemas that reference them.
// Move only side-effect-free literal declarations. Preserve the API's UUID
// dictionary-key validation where Orval drops OpenAPI propertyNames.
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export function hoistLiteralConstants(source) {
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const constants = tree.statements.filter(statement =>
    ts.isVariableStatement(statement)
    && statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    && statement.declarationList.flags & ts.NodeFlags.Const
    && statement.declarationList.declarations.length === 1
    && (() => {
      const value = statement.declarationList.declarations[0].initializer
      return value && (ts.isNumericLiteral(value) || ts.isStringLiteral(value)
        || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword
        || (ts.isPrefixUnaryExpression(value)
          && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)))
    })())
  if (!constants.length) return source
  const imports = tree.statements.filter(ts.isImportDeclaration)
  const boundary = imports.at(-1)?.end ?? 0
  const hoisted = constants.map(statement => source.slice(statement.getStart(tree), statement.end))
  let body = source.slice(boundary)
  for (const statement of [...constants].reverse()) {
    body = body.slice(0, statement.getStart(tree) - boundary)
      + body.slice(statement.end - boundary)
  }
  return source.slice(0, boundary) + '\n\n' + hoisted.join('\n') + '\n' + body
}

export function preservePricingUuidKeys(source) {
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const edits = []
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!['CreateItPricingRuleBody', 'EditItPricingRuleBody'].includes(declaration.name.getText(tree))) continue
      const visit = node => {
        if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'allergenCategoryIds') {
          const record = child => {
            if (ts.isCallExpression(child) && child.expression.getText(tree) === 'zod.record'
                && child.arguments[0]?.getText(tree) === 'zod.string()') {
              edits.push(child.arguments[0].end)
            }
            ts.forEachChild(child, record)
          }
          record(node.initializer)
        } else ts.forEachChild(node, visit)
      }
      if (declaration.initializer) visit(declaration.initializer)
    }
  }
  for (const end of edits.sort((a, b) => b - a)) source = source.slice(0, end) + '.uuid()' + source.slice(end)
  return source
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'hoist-generated-zod-constants.mjs')) {
  const file = path.resolve(import.meta.dirname, '../lib/api-zod/src/generated/api.ts')
  const source = fs.readFileSync(file, 'utf8')
  const result = preservePricingUuidKeys(hoistLiteralConstants(source))
  if (result !== source) fs.writeFileSync(file, result)
}
