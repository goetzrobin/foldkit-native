/**
 * A test harness on ng-native's fake Fabric: mounts a component on a
 * simulated phone, plays the phone's side (touches, typing, scrolling,
 * layout) and reads back what was committed. Like `@effect/ui-opentui/testing`.
 *
 *   const app = yield* NativeTest.mount(Counter, {})
 *   yield* app.press('add')
 *   expect(app.text('count')).toBe('1')
 *
 * The simulated phone records what the program asks for. It cannot show
 * layout or movement: a test here checks logic only.
 */
import type * as Component from '@effect/ui/Component'
import * as Renderer from '@effect/ui/Renderer'
import type * as View from '@effect/ui/View'
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import * as Effect from 'effect/Effect'
import type * as Scope from 'effect/Scope'

import type * as Native from '../Native.js'
import type * as NativeCrash from '../NativeCrash.js'
import * as NativeHost from '../NativeHost.js'

export type TestOptions = NativeHost.SurfaceOptions &
  Readonly<{
    platform?: 'ios' | 'android'
    /** As in `NativeHost.mount`: what to show when a part of the app fails. */
    crash?: NativeCrash.Supervisor<any>
  }>

type Point = Readonly<{ x: number; y: number }>

export interface MountedApp<out Model, in Msg> {
  readonly root: Renderer.Root<Model, Msg>
  readonly fabric: FakeFabric
  readonly surface: NativeHost.NativeSurface
  readonly stats: NativeHost.HostStats
  /** Lets queued Messages, fibers and draws finish. */
  readonly settle: Effect.Effect<void>
  /** Real time passing, for timers (a long press). */
  readonly wait: (ms: number) => Effect.Effect<void>
  /** The committed view with this testID. Throws if there is none. */
  readonly byTestId: (id: string) => FakeFabricNode
  readonly has: (id: string) => boolean
  /** The words drawn inside the view with this testID. */
  readonly text: (id: string) => string
  /** Every piece of text on screen, in order. */
  readonly allText: () => ReadonlyArray<string>
  /** A finger going down and up on a view. */
  readonly press: (id: string) => Effect.Effect<void>
  readonly touchStart: (id: string, at?: Point) => Effect.Effect<void>
  readonly touchMove: (id: string, at: Point) => Effect.Effect<void>
  readonly touchEnd: (id: string, at?: Point) => Effect.Effect<void>
  readonly touchCancel: (id: string) => Effect.Effect<void>
  /** Any native event, as the phone would send it. */
  readonly emit: (id: string, topLevelType: string, nativeEvent?: unknown) => Effect.Effect<void>
  /** The user typing: the field reports its whole new text with the next count. */
  readonly typeText: (id: string, text: string) => Effect.Effect<void>
  /** A scroll view reporting where it is. `byUser: false` is a scroll the program made. */
  readonly scroll: (
    id: string,
    to: Readonly<{ y: number; x?: number; contentHeight?: number; height?: number; byUser?: boolean }>,
  ) => Effect.Effect<void>
  /** Commands sent to native views since the start, by name. */
  readonly commands: () => ReadonlyArray<{ viewName: string; name: string; args: ReadonlyArray<unknown> }>
  /** How many times the screen was committed to the phone. */
  readonly commitCount: () => number
}

const turn = (ms = 0): Effect.Effect<void> =>
  Effect.promise(() => new Promise<void>(resolve => setTimeout(resolve, ms)))

const settle: Effect.Effect<void> = Effect.gen(function* () {
  for (let round = 0; round < 4; round++) yield* turn()
})

export const flatten = (nodes: ReadonlyArray<FakeFabricNode>): Array<FakeFabricNode> =>
  nodes.flatMap(node => [node, ...flatten(node.children)])

export const textOf = (node: FakeFabricNode): string =>
  flatten([node])
    .filter(each => each.viewName === 'RawText')
    .map(each => each.props['text'])
    .filter((value): value is string => typeof value === 'string')
    .join('')

const touchEvent = (node: FakeFabricNode, phase: 'start' | 'move' | 'end', at: Point) => {
  const point = {
    identifier: 0,
    target: node.reactTag,
    pageX: at.x,
    pageY: at.y,
    locationX: at.x,
    locationY: at.y,
    timestamp: Date.now(),
  }
  return { ...point, touches: phase === 'end' ? [] : [point], changedTouches: [point] }
}

const ORIGIN: Point = { x: 0, y: 0 }

/** Mounts `component` on a simulated phone for the life of the current Scope. */
export const mount = <Name extends string, Props, Model, Msg, Events, R, V extends View.Elements, RP = never>(
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & NativeHost.NativeRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options: TestOptions = {},
): Effect.Effect<MountedApp<Model, Msg>, never, Exclude<R | RP, Native.Host> | Scope.Scope> =>
  Effect.gen(function* () {
    const { platform = 'ios', ...surfaceOptions } = options
    registerPlatformComponents(platform)
    const fabric = createFakeFabric()
    let surface: NativeHost.NativeSurface | undefined
    const root = yield* NativeHost.mountEffect(component as any, props as any, {
      dev: false,
      ...surfaceOptions,
      fabric,
      rootTag: 1,
      onSurface: made => {
        surface = made
      },
    })
    const made = surface as NativeHost.NativeSurface
    yield* settle

    const byTestId = (id: string): FakeFabricNode => {
      const found = flatten(fabric.committed).find(node => node.props['testID'] === id)
      if (found === undefined) throw new Error(`No view with testID ${id}`)
      return found
    }
    const act = (run: () => void): Effect.Effect<void> => Effect.andThen(Effect.sync(run), settle)
    const emitNow = (id: string, type: string, nativeEvent?: unknown): void =>
      fabric.emit(byTestId(id), type, nativeEvent)
    const counts = new Map<string, number>()

    const app: MountedApp<Model, Msg> = {
      root: root as Renderer.Root<Model, Msg>,
      fabric,
      surface: made,
      stats: made.stats,
      settle,
      wait: ms => Effect.andThen(turn(ms), settle),
      byTestId,
      has: id => flatten(fabric.committed).some(node => node.props['testID'] === id),
      text: id => textOf(byTestId(id)),
      allText: () =>
        flatten(fabric.committed)
          .filter(node => node.viewName === 'RawText')
          .map(node => node.props['text'])
          .filter((value): value is string => typeof value === 'string'),
      press: id =>
        act(() => {
          emitNow(id, 'topTouchStart', touchEvent(byTestId(id), 'start', ORIGIN))
          emitNow(id, 'topTouchEnd', touchEvent(byTestId(id), 'end', ORIGIN))
        }),
      touchStart: (id, at = ORIGIN) => act(() => emitNow(id, 'topTouchStart', touchEvent(byTestId(id), 'start', at))),
      touchMove: (id, at) => act(() => emitNow(id, 'topTouchMove', touchEvent(byTestId(id), 'move', at))),
      touchEnd: (id, at = ORIGIN) => act(() => emitNow(id, 'topTouchEnd', touchEvent(byTestId(id), 'end', at))),
      touchCancel: id => act(() => emitNow(id, 'topTouchCancel', touchEvent(byTestId(id), 'end', ORIGIN))),
      emit: (id, type, nativeEvent) => act(() => emitNow(id, type, nativeEvent)),
      typeText: (id, text) =>
        act(() => {
          const count = (counts.get(id) ?? 0) + 1
          counts.set(id, count)
          emitNow(id, 'topChange', { text, eventCount: count })
        }),
      scroll: (id, to) =>
        act(() =>
          emitNow(id, 'topScroll', {
            contentOffset: { x: to.x ?? 0, y: to.y },
            contentSize: { width: 390, height: to.contentHeight ?? 0 },
            layoutMeasurement: { width: 390, height: to.height ?? 0 },
            responderIgnoreScroll: to.byUser === false,
          }),
        ),
      commands: () => fabric.commands,
      commitCount: () => fabric.calls.completeRoot,
    }
    return app
  }) as any
