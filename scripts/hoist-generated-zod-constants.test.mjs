import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hoistLiteralConstants } from './hoist-generated-zod-constants.mjs'

test('literal bounds precede consuming schemas without changing expressions', () => {
  const source = `import { z } from 'zod';\nexport const schema = z.number().min(bound);\nexport const bound = 0;\nexport const dynamic = compute();`
  const result = hoistLiteralConstants(source)
  assert.ok(result.indexOf('export const bound = 0;') < result.indexOf('export const schema'))
  assert.ok(result.includes('z.number().min(bound)'))
  assert.ok(result.endsWith('export const dynamic = compute();'))
  assert.equal(hoistLiteralConstants(result).replace(/\s/g, ''), result.replace(/\s/g, ''))
})
