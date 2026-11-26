/**
 * EXPERIMENT: a list that places its rows itself ("way B").
 *
 * The list is a Mount on a scroll view. It listens for the scroll view's
 * scroll events itself, keeps the window outside any Model, and owns a pool
 * of slot views. Each slot holds its own Effect UI tree, mounted with
 * `Renderer.mount` (`Native.Host.mountRoot`). As the window moves, a slot
 * that went out of sight is moved to the other end and its tree is SENT a
 * message naming the row it now shows. No Message goes to the component
 * that owns the list, and its view does not run.
 *
 * What this costs, and what Effect UI lacks for it, is in
 * docs/EFFECT_UI_NATIVE.md ("Way B"). In short: it works, but each row is an
 * island. A mounted root cannot be given new props, so rows are fed by
 * messages. A root cannot report to the component that mounted it. Each
 * root flushes and commits by itself, so the host has to hold commits back.
 * Each root has its own query cache and its own entry in the message log.
 *
 *   h.scrollView.onMount(
 *     SlotList.attach(SlotRow, index => SlotRowMessage.ShowedRow({ index }))({ count: 1000, estimate: 96 })
 *       .pipe(Mount.map(window => Message.MovedWindow(window))))
 */
import type * as Component from '@effect/ui/Component'
import * as Mount from '@effect/ui/Mount'
import type * as Renderer from '@effect/ui/Renderer'
import type { EngineNode } from '@ng-native/fabric'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'

import { Heights, type Range, chooseWindow } from '../../../native/src/host/list/window.js'
import * as Native from '../Native.js'

export type Window = Readonly<{ first: number; end: number }>

type Slot = { readonly node: EngineNode; readonly root: Renderer.Root<unknown, unknown>; index: number; stop: () => void }

/** Counters for the tests: how often the list moved slots, and how many it has. */
export const slotStats = { moves: 0, slots: 0, sends: 0 }

/**
 * `row` is mounted once per slot with `{ index }` as props. `show` builds the
 * message that tells a row's tree which row it shows now.
 */
export const attach = (
  row: Component.Any,
  show: (index: number) => unknown,
  options: Readonly<{ margin?: number; viewport?: number }> = {},
) =>
  Mount.makeStream(
    'AttachSlotList',
    { args: { count: Schema.Number, estimate: Schema.Number } },
    (scroll: Native.Node, args) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const host = yield* Native.Host
          const scope = yield* Scope.Scope
          const engine = host.engine
          return Stream.callback<Window>(queue =>
            Effect.acquireRelease(
              Effect.sync(() => {
                // The content view the host gave the scroll view.
                const content = scroll.childList[0] as EngineNode
                const before = engine.createElement('view')
                const after = engine.createElement('view')
                engine.appendChild(content, before)
                engine.appendChild(content, after)
                const heights = new Heights(Array.from({ length: args.count }, () => args.estimate))
                const margin = options.margin ?? 600
                let viewport = options.viewport ?? 800
                /** The window last chosen. A full pool is drawn, which may be a few rows more. */
                let chosen: Range = { first: 0, end: 0 }
                /** Slots in the order they are on screen: row `drawn.first` first. */
                let slots: Array<Slot> = []

                const makeSlot = (index: number): Slot => {
                  const node = engine.createElement('view')
                  engine.setProp(node, 'collapsable', false)
                  engine.insertBefore(content, node, after)
                  // A separate tree per slot. It lives until the list's Scope closes.
                  const root = Effect.runSync(Effect.provideService(host.mountRoot(row, { index }, node), Scope.Scope, scope))
                  const slot: Slot = { node, root, index, stop: () => {} }
                  slot.stop = engine.setEventListener(node, 'topLayout', event => {
                    const height = (event as { nativeEvent?: { layout?: { height?: number } } })?.nativeEvent?.layout?.height
                    if (typeof height === 'number' && height > 0) heights.set(slot.index, height)
                  })
                  slotStats.slots++
                  return slot
                }

                const place = (offset: number): void => {
                  const next = chooseWindow(heights, offset, viewport, margin, chosen)
                  if (next.first === chosen.first && next.end === chosen.end && slots.length > 0) return
                  chosen = next
                  const release = host.holdCommits()
                  // A full pool is always drawn, as in way A's recycling.
                  const size = Math.max(slots.length, Math.ceil((next.end - next.first) / 8) * 8)
                  const first = next.first
                  const end = Math.min(args.count, first + size)
                  const wanted = new Set<number>()
                  for (let index = first; index < end; index++) wanted.add(index)
                  const free: Array<Slot> = []
                  const kept = new Map<number, Slot>()
                  for (const slot of slots) {
                    if (wanted.has(slot.index) && !kept.has(slot.index)) kept.set(slot.index, slot)
                    else free.push(slot)
                  }
                  const ordered: Array<Slot> = []
                  for (let index = first; index < end; index++) {
                    let slot = kept.get(index)
                    if (slot === undefined) {
                      slot = free.pop()
                      if (slot === undefined) slot = makeSlot(index)
                      else {
                        slot.index = index
                        slot.root.send(show(index))
                        slotStats.sends++
                      }
                    }
                    ordered.push(slot)
                  }
                  // Put the views in row order. A slot already in place is not touched.
                  let reference: EngineNode = after
                  for (let at = ordered.length - 1; at >= 0; at--) {
                    const node = (ordered[at] as Slot).node
                    if (engine.nextSibling(node) !== reference) {
                      engine.insertBefore(content, node, reference)
                      slotStats.moves++
                    }
                    reference = node
                  }
                  slots = [...ordered, ...free]
                  engine.setProp(before, 'style', { height: heights.offsetOf(first) })
                  engine.setProp(after, 'style', { height: Math.max(0, heights.total() - heights.offsetOf(end)) })
                  Queue.offerUnsafe(queue, { first, end })
                  // The rows' trees draw in microtasks queued by `send`. This one comes after them.
                  queueMicrotask(() => {
                    engine.commit()
                    release()
                  })
                }

                const stopScroll = engine.setEventListener(scroll, 'topScroll', event => {
                  const native = (event as { nativeEvent?: { contentOffset?: { y?: number }; layoutMeasurement?: { height?: number } } })
                    ?.nativeEvent
                  const height = native?.layoutMeasurement?.height
                  if (typeof height === 'number' && height > 0) viewport = height
                  place(native?.contentOffset?.y ?? 0)
                })
                engine.setProp(scroll, 'scrollEventThrottle', 16)
                place(0)
                return () => {
                  stopScroll()
                  for (const slot of slots) slot.stop()
                  slotStats.slots -= slots.length
                }
              }),
              stop => Effect.sync(stop),
            ),
          )
        }),
      ),
  )
