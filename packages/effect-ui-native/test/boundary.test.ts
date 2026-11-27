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
/** The state machine library, and the one folder that may import it. */
const MACHINES = 'chat/machines/'
const isMachineLibrary = (name: string): boolean => /^effect-machine(\/|$)/.test(name)
/** The machines' rules: no screen, no phone, nothing of Effect UI. */
const PURE_MACHINES = ['chat/machines/step.ts', 'chat/machines/reply.ts', 'chat/machines/player.ts']

describe('boundary', () => {
  const files = [...filesIn('src'), ...filesIn('playground'), ...filesIn('chat')].filter(file => !file.includes('/testing/'))

  it('imports only effect, @effect/ui, the engine and its own files', () => {
    expect(files.length).toBeGreaterThan(15)
    const strays = files.flatMap(file =>
      importsOf(file)
        .filter(name => !ALLOWED.some(allowed => allowed.test(name)))
        .filter(name => !(file.startsWith(MACHINES) && isMachineLibrary(name)))
        .map(name => `${file}: ${name}`),
    )
    expect(strays).toEqual([])
  })

  it('a machine definition imports effect, effect-machine and other definitions, and nothing else', () => {
    for (const file of PURE_MACHINES) {
      const names = importsOf(file)
      expect(names.length, file).toBeGreaterThan(0)
      const strays = names.filter(
        name => !/^effect$/.test(name) && !isMachineLibrary(name) && !PURE_MACHINES.includes(`chat/machines/${name.replace(/^\.\//, '').replace(/\.js$/, '.ts')}`),
      )
      expect(strays, file).toEqual([])
    }
  })

  it('reaches into packages/native only through its host layer', () => {
    const strays = files.flatMap(file =>
      importsOf(file)
        .filter(name => name.includes('/native/src/') && !name.includes('/native/src/host/'))
        .map(name => `${file}: ${name}`),
    )
    expect(strays).toEqual([])
  })

  it('Effect Chat has no sync bus: nothing it loads, at any depth, is the atoms server state, Foldkit or Fold Chat', () => {
    // Follows every relative import from the chat program's files, and theirs, to the end.
    const seen = new Set<string>()
    const queue = filesIn('chat')
    expect(queue.length).toBeGreaterThan(8)
    const normal = (path: string): string => {
      const parts: Array<string> = []
      for (const part of path.split('/')) {
        if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
        else if (part !== '.') parts.push(part)
      }
      return parts.join('/')
    }
    while (queue.length > 0) {
      const file = queue.pop() as string
      if (seen.has(file)) continue
      seen.add(file)
      const folder = file.slice(0, file.lastIndexOf('/'))
      for (const name of importsOf(file)) {
        if (name.startsWith('.')) queue.push(normal(`${folder}/${name.replace(/\.js$/, '.ts')}`))
      }
    }
    expect([...seen].some(file => file.includes('/host/aiChat/turns.ts'))).toBe(true)
    const strays = [...seen].filter(file => /\/serverState\/|\/foldkit\/|\/flagship\/|\/aiChat\/client\.ts$/.test(file))
    expect(strays).toEqual([])
  })
})
