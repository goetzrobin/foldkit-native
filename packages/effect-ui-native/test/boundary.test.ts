/**
 * What this package may import. It draws with no React and no Foldkit, and
 * from `packages/native` it takes the phone part only (`src/host`).
 */
import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const filesIn = (folder: string): Array<string> =>
  readdirSync(folder, { recursive: true })
    .filter(file => file.endsWith('.ts'))
    .map(file => `${folder}/${file}`)

// Statements only: a comment may say `import 'expo'`. A long import ends on a line that starts with `}`.
const IMPORT = /^(?:import\s+'([^']+)'|(?:import|export|\})[^'\n]*\bfrom\s+'([^']+)')/gm

const importsOf = (file: string): Array<string> =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT)].map(match => (match[1] ?? match[2]) as string)

const ALLOWED = [/^effect(\/|$)/, /^@effect\/ui(\/|$)/, /^@ng-native\/fabric$/, /^\.{1,2}\//]

describe('boundary', () => {
  const files = [...filesIn('src'), ...filesIn('playground')].filter(file => !file.includes('/testing/'))

  it('imports only effect, @effect/ui, the engine and its own files', () => {
    expect(files.length).toBeGreaterThan(15)
    const strays = files.flatMap(file =>
      importsOf(file)
        .filter(name => !ALLOWED.some(allowed => allowed.test(name)))
        .map(name => `${file}: ${name}`),
    )
    expect(strays).toEqual([])
  })

  it('reaches into packages/native only through its host layer', () => {
    const strays = files.flatMap(file =>
      importsOf(file)
        .filter(name => name.includes('/native/src/') && !name.includes('/native/src/host/'))
        .map(name => `${file}: ${name}`),
    )
    expect(strays).toEqual([])
  })
})
