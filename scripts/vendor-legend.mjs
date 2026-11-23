#!/usr/bin/env node
// Copies the React-free part of Legend List into packages/native/src/legend/vendor.
//
//   node scripts/vendor-legend.mjs /path/to/legend-list
//
// Legend List (https://github.com/LegendApp/legend-list, MIT, Moo.do LLC) keeps
// its arithmetic in src/core and src/utils as plain TypeScript. This script
// starts from the functions our driver calls, follows their imports, and copies
// every file it reaches. It changes three things in each file, and nothing else:
//
//   1. Import paths. Legend writes `@/core/x`, which only its own build
//      understands. They become relative paths ending in `.js`, as in the rest
//      of this package, so Metro and Node can resolve them.
//   2. Imports of `react`, `@/platform/*` and `@/constants-platform` point at
//      our own files in `src/legend/platform`, which do not use React.
//   3. A file that calls `requestAnimationFrame` gets one import line for it,
//      so the tests need no browser global.
//
// Where Legend has a `.native.ts` and a web file, the native one is copied
// under the plain name. `state/state.tsx` is not copied by this script: its
// React-free half is kept by hand in `vendor/state/state.ts`.
//
// Running it again overwrites the copies. It never deletes anything.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const legend = process.argv[2]
if (!legend) throw new Error('Give the path to a Legend List checkout')
const SRC = path.join(legend, 'src')
const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '../packages/native/src/legend/vendor')
const OURS = path.join(here, '../packages/native/src/legend/platform')

/** The functions the driver and Legend's own component call. */
const ENTRIES = [
  'core/calculateItemsInView', 'core/onScroll', 'core/updateItemSizes', 'core/handleLayout',
  'core/doInitialAllocateContainers', 'core/checkResetContainers', 'core/initialScrollLifecycle',
  'core/bootstrapInitialScroll', 'core/scrollToEnd', 'core/scrollTo', 'core/scrollToIndex',
  'core/doScrollTo', 'core/doMaintainScrollAtEnd', 'core/updateAnchoredEndSpace',
  'core/updateContentMetricsState', 'core/updateContentMetrics', 'core/updateItemPositions',
  'core/measureContainersInLayoutEffect', 'core/scheduleContainerLayout',
  'core/checkStructuralDataChange', 'core/resetLayoutCachesForDataChange', 'core/itemSizeCache',
  'core/userMomentum', 'core/cancelImperativeScroll', 'core/cancelScroll',
  'core/finishMaintainScrollAtEnd', 'core/ScheduledWork', 'core/ScrollAdjustHandler',
  'core/updateScroll', 'core/checkFinishedScroll', 'core/endOfContentTarget', 'core/initialScroll',
  'core/finishInitialScroll', 'core/containerLayoutReady', 'core/clampScrollOffset',
  'core/containerItemMetadata', 'core/viewability', 'core/updateContentInsetEndAdjustment',
  'utils/checkThresholds', 'utils/getId', 'utils/getRenderedItem', 'utils/setPaddingTop',
  'utils/normalizeMaintainScrollAtEnd', 'utils/normalizeMaintainVisibleContentPosition',
  'utils/edgeReachedGate', 'utils/getAlwaysRenderIndices', 'utils/setInitialRenderState',
  'utils/requestAdjust', 'utils/createImperativeHandle', 'utils/helpers', 'utils/createColumnWrapperStyle', 'utils/rtl',
  'state/getContentSize', 'platform/platform-types', 'platform/scrollview-types',
]

/** Imports that go to our own files in place of Legend's. */
const OUR_FILES = new Map([
  ['react', 'react'],
  ['@/constants-platform', 'constants-platform'],
  ['@/platform/Platform', 'Platform'],
  ['@/platform/I18nManager', 'I18nManager'],
  ['@/platform/PixelRatio', 'PixelRatio'],
  ['@/platform/batchedUpdates', 'batchedUpdates'],
  ['@/platform/flushSync', 'flushSync'],
  ['@/platform/getWindowSize', 'getWindowSize'],
  ['@/platform/screenReader', 'screenReader'],
])
const HAND_KEPT = new Set(['state/state'])

const find = base => {
  for (const ext of ['.native.ts', '.native.tsx', '.ts', '.tsx']) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  return undefined
}
const plainName = file => path.relative(SRC, file).replace(/\.native(?=\.tsx?$)/, '')
const relative = (fromFile, toFile) => {
  const to = path.relative(path.dirname(fromFile), toFile).replace(/\.tsx?$/, '.js')
  return to.startsWith('.') ? to : `./${to}`
}

const copied = new Map()
const copy = id => {
  if (HAND_KEPT.has(id)) return
  const source = find(path.join(SRC, id))
  if (source === undefined) throw new Error(`Legend has no ${id}`)
  if (copied.has(source)) return
  const target = path.join(OUT, plainName(source))
  copied.set(source, target)
  let text = fs.readFileSync(source, 'utf8')
  const notes = []
  text = text.replace(/(from\s+)(["'])([^"']+)\2/g, (whole, from, quote, spec) => {
    if (OUR_FILES.has(spec)) {
      return `${from}${quote}${relative(target, path.join(OURS, `${OUR_FILES.get(spec)}.ts`))}${quote}`
    }
    let depId
    if (spec.startsWith('@/')) depId = spec.slice(2)
    else if (spec.startsWith('.')) depId = path.relative(SRC, path.join(path.dirname(source), spec))
    else throw new Error(`${id} imports ${spec}, which is not vendored`)
    if (HAND_KEPT.has(depId)) {
      return `${from}${quote}${relative(target, path.join(OUT, `${depId}.ts`))}${quote}`
    }
    const dep = find(path.join(SRC, depId))
    if (dep === undefined) throw new Error(`${id} imports ${spec}, which Legend does not have`)
    copy(depId)
    return `${from}${quote}${relative(target, path.join(OUT, plainName(dep)))}${quote}`
  })
  // `import type React from "react"` needs a default export our file lacks.
  if (/import type React from /.test(text)) {
    text = text.replace(/import type React from /, 'import type * as React from ')
    notes.push('`import type React` became `import type * as React`: our stand-in has no default export.')
  }
  const frames = ['cancelAnimationFrame', 'requestAnimationFrame'].filter(name =>
    new RegExp(`\\b${name}\\(`).test(text),
  )
  if (frames.length > 0) {
    const line = `import { ${frames.join(', ')} } from "${relative(target, path.join(OURS, 'frame.ts'))}";`
    text = `// foldkit-native: the next frame comes from our own file, so no browser global is needed.\n${line}\n${text}`
    notes.push('One added import line for `requestAnimationFrame`.')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
  copied.set(source, { target, notes, native: /\.native\.tsx?$/.test(source) })
}
for (const entry of ENTRIES) copy(entry)

const rows = [...copied.entries()]
  .map(([source, info]) => ({ from: path.relative(SRC, source), ...info }))
  .sort((a, b) => a.from.localeCompare(b.from))
fs.writeFileSync(
  path.join(OUT, 'FILES.txt'),
  rows
    .map(row => {
      const extra = [row.native ? 'copied under the plain name' : '', ...row.notes].filter(Boolean)
      return `src/${row.from}${extra.length ? `  --  ${extra.join(' ')}` : ''}`
    })
    .join('\n') + '\n',
)
console.log(`Copied ${rows.length} files into ${path.relative(process.cwd(), OUT)}`)
