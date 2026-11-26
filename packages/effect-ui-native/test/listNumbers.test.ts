/**
 * The numbers for the list question: how many components draw again per
 * scroll step, and how much JavaScript time a step takes, for 1,000
 * Markdown-like rows.
 *
 * The simulated phone lays nothing out, so this test plays that part: after
 * each draw it reports a height for every row that is new, worked out from
 * the row's text, as a phone would.
 *
 * Time here is Node on a laptop. Hermes on a phone has no JIT and is several
 * times slower. The counts are exact everywhere.
 */
import { appendFileSync } from 'node:fs'

import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Mount, UiSchema } from '@effect/ui'
import { Effect, Exit, Schema, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { LongList, ROW_COUNT, Row, rowData, viewRuns } from '../playground/longList.js'
import * as SlotList from '../src/experimental/SlotList.js'
import { Native } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const VIEWPORT = 800

/** How tall a phone would lay a row out: 15 point text, about 46 letters to a line. */
export const heightOfRow = (index: number): number => {
  const row = rowData(index)
  const lines = Math.ceil(row.body.length / 46)
  return 24 + 22 + lines * 21 + (row.bullets === '' ? 0 : 46) + (row.code === '' ? 0 : 38)
}

const drain = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve()
}

type Step = { ms: number; list: number; rows: number; created: number; destroyed: number; commits: number }

const summary = (steps: ReadonlyArray<Step>) => {
  const drew = steps.filter(step => step.commits > 0)
  const idle = steps.filter(step => step.commits === 0)
  const sorted = [...drew].sort((a, b) => a.ms - b.ms)
  const mean = (values: ReadonlyArray<number>) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    steps: steps.length,
    stepsThatDrew: drew.length,
    stepsThatDrewNothing: idle.length,
    msPerDrawingStep: {
      mean: round(mean(drew.map(step => step.ms))),
      p95: round(sorted[Math.floor(sorted.length * 0.95)]?.ms ?? 0),
      max: round(sorted[sorted.length - 1]?.ms ?? 0),
    },
    msPerIdleStep: round(mean(idle.map(step => step.ms))),
    listViewsPerDrawingStep: round(mean(drew.map(step => step.list))),
    rowViewsPerDrawingStep: round(mean(drew.map(step => step.rows))),
    maxRowViewsInAStep: Math.max(0, ...drew.map(step => step.rows)),
    nativeViewsCreatedPerDrawingStep: round(mean(drew.map(step => step.created))),
    commitsPerDrawingStep: round(mean(drew.map(step => step.commits))),
  }
}

const measure = (
  label: string,
  options: { recycle: boolean; stepPoints: number; steps: number; wayB?: boolean },
) =>
  Effect.gen(function* () {
    const app: NativeTest.MountedApp<any, any> = options.wayB === true
      ? yield* NativeTest.mount(SlotDemo, {}, { scrollThrottleMs: 0 })
      : yield* NativeTest.mount(LongList, { hasReadout: false }, { scrollThrottleMs: 0 })
    if (options.recycle && options.wayB !== true) yield* app.press('list-recycle')
    const reported = new Map<number, number>()
    /** The phone's layout pass: every new row says how tall it is, in one batch. */
    const layOut = (): void => {
      const rows = NativeTest.flatten(app.fabric.committed).filter(node =>
        /^row-\d+$/.test(String(node.props['testID'] ?? '')),
      )
      const holders = new Map<FakeFabricNode, number>()
      const walk = (node: FakeFabricNode): void => {
        for (const child of node.children) {
          const id = String(child.props['testID'] ?? '')
          if (/^row-\d+$/.test(id)) holders.set(node, Number(id.slice(4)))
          else walk(child)
        }
      }
      for (const top of app.fabric.committed) walk(top)
      void rows
      for (const [holder, index] of holders) {
        const height = heightOfRow(index)
        if (reported.get(holder.reactTag) === height) continue
        reported.set(holder.reactTag, height)
        app.fabric.emit(holder, 'topLayout', { layout: { x: 0, y: 0, width: 390, height } })
      }
    }
    const scrollTo = (y: number): void =>
      app.fabric.emit(app.byTestId('long-list'), 'topScroll', {
        contentOffset: { x: 0, y },
        contentSize: { width: 390, height: 100_000 },
        layoutMeasurement: { width: 390, height: VIEWPORT },
        responderIgnoreScroll: false,
      })
    yield* Effect.promise(async () => {
      layOut()
      await drain()
    })
    const steps: Array<Step> = []
    const pass = (from: number): Promise<void> =>
      (async () => {
        for (let step = 1; step <= options.steps; step++) {
          const before = { ...viewRuns, created: app.stats.created, destroyed: app.stats.destroyed, commits: app.stats.commits }
          const started = performance.now()
          scrollTo(from + step * options.stepPoints)
          await drain()
          // The rows that came in are measured, and their Messages handled, in the same step.
          layOut()
          await drain()
          steps.push({
            ms: performance.now() - started,
            list: viewRuns.list - before.list,
            rows: viewRuns.rows - before.rows,
            created: app.stats.created - before.created,
            destroyed: app.stats.destroyed - before.destroyed,
            commits: app.stats.commits - before.commits,
          })
        }
      })()
    // Once to warm up, then the pass that is measured, further down the list.
    yield* Effect.promise(() => pass(0))
    steps.length = 0
    yield* Effect.promise(() => pass(options.steps * options.stepPoints))
    const result = { label, ...options, liveNativeViews: app.stats.live, ...summary(steps) }
    appendFileSync(process.env['EUI_NUMBERS'] ?? '/tmp/eui-list-numbers.jsonl', JSON.stringify(result) + '\n')
    return { result, app }
  })

// WAY B: the list places the rows itself. See src/experimental/SlotList.ts.

const SlotRowMessage = UiSchema.TaggedEnum({ ShowedRow: { index: Schema.Number }, PressedRow: {} })

/** A row that is its own tree. It is told which row it shows by a message, because a root's props cannot change. */
const SlotRow = Native.component({
  name: 'SlotRow',
  props: Schema.Struct({ index: Schema.Number }),
  model: Schema.Struct({ index: Schema.Number, presses: Schema.Number }),
  message: SlotRowMessage,
}).make({
  init: $ => ({ index: $.props.index, presses: 0 }),
  update: {
    ShowedRow: ($, { index }) => $.evolve({ index, presses: 0 }),
    PressedRow: $ => $.evolve({ presses: n => n + 1 }),
  },
  view: (h, model) => {
    viewRuns.rows++
    return h.pressable
      .testId(`row-${model.index}`)
      .on('press', SlotRowMessage.PressedRow())
      .children(Row(h, { props: rowData(model.index) }), h.text.testId(`presses-${model.index}`).children(String(model.presses)))
  },
})

const SlotDemoMessage = UiSchema.TaggedEnum({ MovedWindow: { first: Schema.Number, end: Schema.Number } })

const attachRows = SlotList.attach(SlotRow, index => SlotRowMessage.ShowedRow({ index }))

const SlotDemo = Native.component({
  name: 'SlotDemo',
  model: Schema.Struct({ first: Schema.Number, end: Schema.Number }),
  message: SlotDemoMessage,
}).make({
  init: () => ({ first: 0, end: 0 }),
  // The owner hears where the window is, and keeps it without drawing anything from it.
  update: { MovedWindow: ($, window) => ($.model.first === window.first && $.model.end === window.end ? $.model : $.model) },
  view: h => {
    viewRuns.list++
    return h.scrollView
      .testId('long-list')
      .style({ flex: 1 })
      .onMount(attachRows({ count: ROW_COUNT, estimate: 96 }).pipe(Mount.map(window => SlotDemoMessage.MovedWindow(window))))
  },
})

describe('list numbers, way B (the list places its rows, each row its own tree)', () => {
  it('works: rows draw, only the rows that change run their views, and the owner never draws', () =>
    run(
      Effect.gen(function* () {
        const { result, app } = yield* measure('B, slots with separate trees, 120 pt steps', {
          recycle: true,
          stepPoints: 120,
          steps: 150,
          wayB: true,
        })
        expect(result.listViewsPerDrawingStep).toBe(0)
        expect(result.nativeViewsCreatedPerDrawingStep).toBeLessThan(1)
        expect(result.commitsPerDrawingStep).toBeLessThanOrEqual(1)
        // A row is its own island: it can hold its own state and take its own presses.
        const shown = NativeTest.flatten(app.fabric.committed)
          .map(node => String(node.props['testID'] ?? ''))
          .find(id => /^row-\d+$/.test(id)) as string
        yield* app.press(shown)
        expect(app.text(shown.replace('row', 'presses'))).toBe('1')
        yield* measure('B, slots with separate trees, 600 pt steps', { recycle: true, stepPoints: 600, steps: 60, wayB: true })
      }),
    ))

  it('unmounting the list closes every row tree', () =>
    run(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const app = yield* NativeTest.mount(SlotDemo, {}).pipe(Effect.provideService(Scope.Scope, scope))
        expect(app.stats.live).toBeGreaterThan(50)
        yield* Scope.close(scope, Exit.void)
        expect(app.stats.live).toBe(0)
        expect(app.stats.listeners).toBe(0)
        expect(app.stats.wired).toBe(0)
      }),
    ))
})

describe('list numbers, way A', () => {
  it('scrolling by 120 points a step: most steps draw nothing, a drawing step runs the list view once and only the new rows', () =>
    run(
      Effect.gen(function* () {
        const { result, app } = yield* measure('A, keyed by id, 120 pt steps', { recycle: false, stepPoints: 120, steps: 150 })
        expect(result.stepsThatDrewNothing).toBeGreaterThan(result.steps / 2)
        expect(result.listViewsPerDrawingStep).toBeLessThanOrEqual(2)
        // Only rows that came into the window run their view: never the whole window.
        expect(result.maxRowViewsInAStep).toBeLessThan(15)
        expect(result.liveNativeViews).toBeLessThan(400)
        expect(app.root.model()?.list.end).toBeLessThan(ROW_COUNT)
      }),
    ))

  it('a fast fling, 600 points a step', () =>
    run(
      Effect.gen(function* () {
        const { result } = yield* measure('A, keyed by id, 600 pt steps', { recycle: false, stepPoints: 600, steps: 60 })
        expect(result.listViewsPerDrawingStep).toBeLessThanOrEqual(2)
      }),
    ))

  it('recycling: rows that come in reuse the views of rows that went out', () =>
    run(
      Effect.gen(function* () {
        const { result } = yield* measure('A, recycled by slot, 120 pt steps', { recycle: true, stepPoints: 120, steps: 150 })
        expect(result.nativeViewsCreatedPerDrawingStep).toBeLessThan(2)
        const fling = yield* measure('A, recycled by slot, 600 pt steps', { recycle: true, stepPoints: 600, steps: 60 })
        expect(fling.result.nativeViewsCreatedPerDrawingStep).toBeLessThan(2)
      }),
    ))
})
