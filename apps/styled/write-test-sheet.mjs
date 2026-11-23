// Copies this app's compiled Tailwind sheet into the adapter's tests, as
// packages/native/test/fixtures/styling-sheet.json.
//
// The tests run in plain Node with no Tailwind and no CSS compiler, so they
// read a sheet that was compiled here, by the real pipeline (Tailwind's CLI,
// then ng-native's compiler). Run this after changing the classes in
// packages/native/test/demos/styling.ts:
//
//   ./sync.sh && node metro.config.js && node write-test-sheet.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const module_ = readFileSync(resolve(here, '.foldkit-native/tailwind.js'), 'utf8')
const start = module_.indexOf('export default ') + 'export default '.length
const sheet = JSON.parse(module_.slice(start).trim().replace(/;$/, ''))
const out = resolve(here, '../../packages/native/test/fixtures/styling-sheet.json')
writeFileSync(out, JSON.stringify(sheet, null, 1) + '\n')
console.log(`Wrote ${sheet.rules.length} rules to ${out}`)
