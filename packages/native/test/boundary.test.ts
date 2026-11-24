/**
 * The line between the two layers of `src`, checked on every test run.
 *
 * - `src/host` knows nothing of Foldkit. It may import `effect`,
 *   `@ng-native/fabric` and other files in `src/host`, and nothing else.
 *   When Foldkit becomes Effect UI, this layer stays as it is.
 * - `src/foldkit` is the binding: the only folder whose files import
 *   `foldkit` themselves. The re-export files at the old public paths
 *   (`src/index.ts`, `src/<folder>/index.ts`) import the binding, never
 *   `foldkit` directly.
 *
 * Imports are read from the source text with comments removed, so an
 * example in a comment does not count.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const host = join(src, 'host')
const binding = join(src, 'foldkit')

const filesUnder = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder).flatMap(name => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return name.endsWith('.ts') ? [path] : []
  })

const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** Every module a file imports or re-exports, as written. */
const importsOf = (path: string): ReadonlyArray<string> => {
  const code = withoutComments(readFileSync(path, 'utf8'))
  const found: Array<string> = []
  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.push(match[1] as string)
  }
  return found
}

const isFoldkit = (specifier: string): boolean =>
  specifier === 'foldkit' || specifier.startsWith('foldkit/')

const ALLOWED_PACKAGES = ['effect', '@ng-native/fabric']

/** Why a host file may not import this, or undefined if it may. */
const hostProblem = (path: string, specifier: string): string | undefined => {
  if (specifier.startsWith('.')) {
    const target = resolve(dirname(path), specifier)
    return target.startsWith(host + '/') ? undefined : 'reaches outside src/host'
  }
  const isAllowed = ALLOWED_PACKAGES.some(
    name => specifier === name || specifier.startsWith(name + '/'),
  )
  return isAllowed ? undefined : 'is a package the host layer may not use'
}

describe('the host layer', () => {
  it('has files', () => {
    expect(filesUnder(host).length).toBeGreaterThan(50)
  })

  it('imports only effect, @ng-native/fabric and its own files', () => {
    const problems = filesUnder(host).flatMap(path =>
      importsOf(path).flatMap(specifier => {
        const problem = hostProblem(path, specifier)
        return problem === undefined ? [] : [`${relative(src, path)}: '${specifier}' ${problem}`]
      }),
    )
    expect(problems).toEqual([])
  })
})

describe('the Foldkit binding', () => {
  it('is the only folder that imports foldkit', () => {
    const outside = filesUnder(src)
      .filter(path => !path.startsWith(binding + '/'))
      .filter(path => importsOf(path).some(isFoldkit))
      .map(path => relative(src, path))
    expect(outside).toEqual([])
  })

  it('imports foldkit', () => {
    const importing = filesUnder(binding).filter(path => importsOf(path).some(isFoldkit))
    expect(importing.length).toBeGreaterThan(20)
  })
})
