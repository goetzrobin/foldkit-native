/**
 * Draws a list's rows with Foldkit's updater: the painter the host list
 * (`src/host/list/controller.ts`) asks for. The host decides which rows are
 * drawn, where and how tall the canvas is. This file builds those rows with
 * the program's `row` function and patches them into the canvas with a
 * second updater that has the same modules as Foldkit's own.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { type VNode, h, init, onUnmountModule } from 'foldkit/renderTarget'

import type {
  CanvasPlan,
  ListSpec,
  PainterFactory,
  RowKey,
  RowPainter,
} from '../../host/list/controller.js'
import { makeModules, nodeOf } from '../modules.js'
import { makeNodeApi } from '../nodeApi.js'

type RowUpdater = Readonly<{
  patch: (before: VNode, after: VNode) => VNode
  /** Work the rows' modules queued for after the commit. */
  jobs: Array<() => void>
}>

// The second updater, for the rows. One for each updater that draws lists
// (the program's, and this one again for a list inside a row), made on first
// use: it holds a copy of every registered module, the list's included, so a
// row may hold a list.
const updaters = new WeakMap<object, RowUpdater>()

const updaterFor = (engine: Engine, owner: object): RowUpdater => {
  let updater = updaters.get(owner)
  if (updater === undefined) {
    const jobs: Array<() => void> = []
    const patch = init(
      [...makeModules(engine, job => jobs.push(job)), onUnmountModule],
      makeNodeApi(engine),
    )
    updater = { patch: (before, after) => patch(before, after), jobs }
    updaters.set(owner, updater)
  }
  return updater
}

export const foldkitPainter: PainterFactory = (engine, content, owner): RowPainter => {
  // The row updater replaces the node it is given, so it gets a placeholder
  // inside the content view to replace with the canvas.
  const placeholder = engine.createAnchor()
  engine.appendChild(content, placeholder)
  let canvas: VNode = {
    sel: '!',
    data: {},
    children: undefined,
    text: '',
    elm: placeholder as unknown as Element,
    key: undefined,
  }
  /** The row vnodes drawn now, kept so an unchanged row is not built again. */
  let rows = new Map<RowKey, VNode>()
  const patch = (next: VNode): void => {
    canvas = updaterFor(engine, owner).patch(canvas, next)
  }

  const rowVNode = (plan: CanvasPlan, spec: ListSpec<any>, key: RowKey, at: number): VNode => {
    const kept = rows.get(key)
    if (kept !== undefined) return kept
    const built = spec.inFrame(() => spec.row(spec.items[at], at)) as VNode | null
    return h(
      'view',
      plan.rowHeight === undefined
        ? { key, on: { layout: (event: unknown) => plan.onRowLayout(key, event) } }
        : { key, props: { style: { height: plan.rowHeight, overflow: 'hidden' } } },
      built === null ? [] : [built],
    )
  }

  return {
    paint: (plan, spec) => {
      const drawn = new Map<RowKey, VNode>()
      for (const { key, index } of plan.rows) drawn.set(key, rowVNode(plan, spec, key, index))
      rows = drawn
      patch(
        h(
          'view',
          // Never collapsed: with only a height it would be optimised away, and
          // a drag that starts between rows would not scroll.
          { props: { collapsable: false, style: plan.style } },
          [
            h('view', { key: plan.spacerKey, props: { style: { height: plan.spacerHeight } } }),
            ...drawn.values(),
          ],
        ),
      )
    },
    forget: () => {
      rows = new Map()
    },
    clear: () => {
      rows = new Map()
      patch(h('view', { props: { collapsable: false } }, []))
    },
    nodeOf: key => {
      const vnode = rows.get(key)
      return vnode === undefined ? undefined : nodeOf(vnode)
    },
    canvas: () => canvas.elm as unknown as EngineNode | undefined,
    afterCommit: () => {
      const updater = updaters.get(owner)
      if (updater === undefined) return
      for (const job of updater.jobs.splice(0)) job()
    },
  }
}
