// Copies react-native-keyboard-controller's own test cases for its chat
// scroll view into packages/native/test, so that our port of its arithmetic
// (packages/native/src/chat/vendor/kbc) is checked against the numbers the
// library itself expects.
//
//   node scripts/port-kbc-specs.mjs /path/to/react-native-keyboard-controller
//
// The cases are copied as they are. Only the top of each file changes: the
// library's tests mock React hooks with jest, and ours call the plain object
// in `chatKeyboard.ts` through `test/support/kbcFixture.ts`.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const from = process.argv[2]
if (!from) throw new Error('Pass the path of a react-native-keyboard-controller checkout')
const chat = join(from, 'src/components/KeyboardChatScrollView')
const out = join(import.meta.dirname, '../packages/native/test')

const banner = (files) => `/**
 * Test cases from react-native-keyboard-controller 1.22.7 (MIT, copyright
 * Kiryl Ziusko), copied by scripts/port-kbc-specs.mjs from:
 *
${files.map(file => ` *   ${file}`).join('\n')}
 *
 * Do not edit by hand. The cases are the library's own. Only the lines above
 * the first \`describe\` of each file were replaced, to call our port.
 */
`

/** Everything after the file's own set-up: from the end of its `beforeEach`,
 *  or else from the first top-level `describe(` and the comment above it. */
const casesOf = (source) => {
  const setUp = 'beforeEach(() => {\n  setupBeforeEach();\n});\n'
  const cut = source.indexOf(setUp)
  if (cut >= 0) return source.slice(cut + setUp.length).trimStart()
  const lines = source.split('\n')
  let at = lines.findIndex(line => line.startsWith('describe('))
  while (at > 0 && lines[at - 1].startsWith('//')) at -= 1
  return lines.slice(at).join('\n')
}

const read = (path) => readFileSync(join(chat, path), 'utf8')

// 1. The pure helpers.
{
  const path = 'useChatKeyboard/__tests__/helpers.spec.ts'
  writeFileSync(
    join(out, 'kbcHelpers.test.ts'),
    banner([path]) +
      `import { describe, expect, it } from 'vitest'

import {
  clampedScrollTarget,
  computeIOSContentOffset,
  getEffectiveHeight,
  getMinimumPaddingAbsorbed,
  getScrollEffective,
  isScrollAtEnd,
  shouldShiftContent,
} from '../src/chat/vendor/kbc/helpers.js'

` +
      casesOf(read(path)),
  )
}

// 2. The keyboard handlers, iOS.
{
  const paths = [
    'index.ios.spec.ts',
    'blankSpace.ios.spec.ts',
    'offset.ios.spec.ts',
    'persistent.ios.spec.ts',
    'index.ios.ecp.spec.ts',
  ].map(name => `useChatKeyboard/__tests__/${name}`)
  writeFileSync(
    join(out, 'kbcChatKeyboard.test.ts'),
    banner(paths) +
      `import { beforeEach, describe, expect, it } from 'vitest'

import {
  KEYBOARD,
  type SharedValue,
  handlers,
  mockLayout,
  mockOffset,
  mockScrollTo,
  mockSize,
  render,
  setupBeforeEach,
  sv,
} from './support/kbcFixture.js'

beforeEach(() => {
  setupBeforeEach()
})

` +
      paths
        .map(path => `// ---- ${path}\n\ndescribe('${path.split('/').at(-1)}', () => {\n${casesOf(read(path))}\n})\n`)
        .join('\n'),
  )
}

// 3. The composer changing height.
{
  const paths = [
    'always.spec.ts',
    'whenAtEnd.spec.ts',
    'persistent.spec.ts',
    'never.spec.ts',
    'blankSpace.spec.ts',
    'edge-cases.spec.ts',
    'contentOffsetY.spec.ts',
  ].map(name => `useExtraContentPadding/__tests__/${name}`)
  writeFileSync(
    join(out, 'kbcExtraContentPadding.test.ts'),
    banner(paths) +
      `import { beforeEach, describe, expect, it } from 'vitest'

import {
  createEcpRender as createRender,
  flushRAF,
  mockScrollTo,
  reactionEffect,
  setupEcpBeforeEach,
  sv,
  withLegacyArch,
} from './support/kbcFixture.js'

beforeEach(() => {
  setupEcpBeforeEach()
})

` +
      paths.map(path => `// ---- ${path}\n\n${casesOf(read(path))}\n`).join('\n'),
  )
}
console.log('Ported the react-native-keyboard-controller specs into packages/native/test')
