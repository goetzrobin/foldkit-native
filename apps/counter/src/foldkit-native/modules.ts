/**
 * What an element carries besides its children: properties, classes, inline
 * styles and event handlers. Foldkit's web modules write these to browser
 * elements. These write them to engine nodes.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import type { Module, VNode } from 'foldkit/renderTarget'

import { registeredModules } from './extend'

export type Bag = Record<string, unknown>

const EMPTY: Bag = {}

export const nodeOf = (vnode: VNode): EngineNode | undefined => {
  const node = vnode.elm as unknown as EngineNode | undefined
  return node !== undefined && node.nodeKind === 'element' ? node : undefined
}

export const bagOf = (vnode: VNode, key: 'props' | 'attrs' | 'class' | 'style' | 'on') =>
  ((vnode.data as Bag | undefined)?.[key] as Bag | undefined) ?? EMPTY

const TEXT_INPUT = 'text-input'

const isPlain = (value: unknown): value is Bag =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype

/** A view builds a new style object on every draw. Equal contents are no change. */
const isSame = (before: unknown, after: unknown): boolean => {
  if (before === after) return true
  if (!isPlain(before) || !isPlain(after)) return false
  const names = Object.keys(after)
  return (
    names.length === Object.keys(before).length &&
    names.every(name => before[name] === after[name])
  )
}

/** A text field's `value` is kept in step by `textInputModule`, not as a prop. */
const isFieldValue = (node: EngineNode, name: string): boolean =>
  name === 'value' && node.tag === TEXT_INPUT

/** Properties and attributes both become native props. */
const propsModule = (engine: Engine): Partial<Module> => {
  const update = (oldVnode: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    for (const key of ['props', 'attrs'] as const) {
      const before = bagOf(oldVnode, key)
      const after = bagOf(vnode, key)
      if (before === after) continue
      for (const name in before) {
        if (isFieldValue(node, name)) continue
        if (!(name in after)) engine.setProp(node, name, undefined)
      }
      for (const name in after) {
        if (isFieldValue(node, name)) continue
        if (!isSame(before[name], after[name])) engine.setProp(node, name, after[name])
      }
    }
  }
  return { create: update, update }
}

const classModule = (engine: Engine): Partial<Module> => {
  const update = (oldVnode: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const before = bagOf(oldVnode, 'class')
    const after = bagOf(vnode, 'class')
    if (before === after) return
    for (const name in before) {
      if (before[name] && !after[name]) engine.removeClass(node, name)
    }
    for (const name in after) {
      if (after[name] && !before[name]) engine.addClass(node, name)
    }
  }
  return { create: update, update }
}

/** A CSS-style name and text value, as the native view reads it. */
const styleKey = (name: string): string =>
  name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())

const styleValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim())
  return match ? Number(match[1]) : value
}

const styleModule = (engine: Engine): Partial<Module> => {
  const update = (oldVnode: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const before = bagOf(oldVnode, 'style')
    const after = bagOf(vnode, 'style')
    if (before === after) return
    const names = Object.keys(after)
    if (names.length === 0) {
      if (Object.keys(before).length > 0) engine.setProp(node, 'style', undefined)
      return
    }
    const style: Bag = {}
    for (const name of names) style[styleKey(name)] = styleValue(after[name])
    engine.setProp(node, 'style', style)
  }
  return { create: update, update }
}

export type Handler = (event: unknown) => void
type Stops = Map<string, () => void>

const stopsByNode = new WeakMap<EngineNode, Stops>()
export const handlersByNode = new WeakMap<EngineNode, Bag>()

/** An engine event name for a Foldkit handler name: `scroll` is `topScroll`. */
const topLevelType = (name: string): string =>
  'top' + name.charAt(0).toUpperCase() + name.slice(1)

type CustomEventMaker = new (name: string, init: { detail: unknown }) => unknown

/**
 * Foldkit's custom-event handlers check `event instanceof CustomEvent`. Where
 * the phone's JavaScript engine has no such class, this one stands in.
 */
const customEventClass = (): CustomEventMaker => {
  const host = globalThis as { CustomEvent?: CustomEventMaker }
  if (host.CustomEvent === undefined) {
    host.CustomEvent = class {
      readonly type: string
      readonly detail: unknown
      constructor(type: string, init: { detail: unknown }) {
        this.type = type
        this.detail = init.detail
      }
      preventDefault(): void {}
      stopPropagation(): void {}
    }
  }
  return host.CustomEvent
}

/** A native event as a custom event: its payload is the `detail`. */
export const customEvent = (name: string, native: unknown): unknown =>
  new (customEventClass())(name, { detail: native })

/** The least a web handler reads from an event. */
const stubEvent = (native: unknown): Bag => ({
  nativeEvent: native,
  detail: native,
  preventDefault: () => {},
  stopPropagation: () => {},
})

/**
 * `click` has no native event of its own: a press is a touch that starts and
 * ends on the view. This is the smallest version of that. A full one also
 * cancels when the finger slides away and reports the pressed state.
 */
const listenForPress = (engine: Engine, node: EngineNode): (() => void) =>
  engine.setResponder(node, {
    onStartShouldSetResponder: () => true,
    onResponderRelease: event => {
      const handler = handlersByNode.get(node)?.['click'] as Handler | undefined
      handler?.(stubEvent(event))
    },
  })

const eventsModule = (engine: Engine): Partial<Module> => {
  const update = (oldVnode: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const before = bagOf(oldVnode, 'on')
    const after = bagOf(vnode, 'on')
    if (before === after) return
    // Listeners stay attached across renders and read the newest handler.
    handlersByNode.set(node, after)
    let stops = stopsByNode.get(node)
    for (const name in before) {
      if (!(name in after)) {
        stops?.get(name)?.()
        stops?.delete(name)
      }
    }
    for (const name in after) {
      if (stops?.has(name)) continue
      if (name === 'input' && node.tag === TEXT_INPUT) continue
      if (stops === undefined) stopsByNode.set(node, (stops = new Map()))
      stops.set(
        name,
        name === 'click'
          ? listenForPress(engine, node)
          : engine.setEventListener(node, topLevelType(name), event => {
              const handler = handlersByNode.get(node)?.[name] as Handler | undefined
              handler?.(customEvent(name, (event as { nativeEvent?: unknown })?.nativeEvent))
            }),
      )
    }
  }
  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const stops = stopsByNode.get(node)
    if (stops === undefined) return
    for (const stop of stops.values()) stop()
    stopsByNode.delete(node)
    handlersByNode.delete(node)
  }
  return { create: update, update, destroy }
}

type Field = {
  /** The text the phone last reported, or null before the user has typed. */
  lastNativeText: string | null
  /** The phone numbers each change. Text sent back carries the number it
   *  answers, and the phone ignores an answer older than what it now shows. */
  eventCount: number
  stop: () => void
}

const fields = new WeakMap<EngineNode, Field>()

const valueOf = (vnode: VNode): string => {
  const value = bagOf(vnode, 'attrs')['value'] ?? bagOf(vnode, 'props')['value']
  return typeof value === 'string' ? value : ''
}

/**
 * A text field tied to the Model.
 *
 * The phone owns the text while the user types. Each change arrives here with
 * a count, becomes the `input` handler's Message, and the Model catches up.
 * After each draw, if the Model's text differs from what the phone last
 * reported (the program changed or refused what was typed), the Model's text
 * is sent back with the latest count.
 */
const textInputModule = (
  engine: Engine,
  afterCommit: (job: () => void) => void,
): Partial<Module> => {
  const create = (_empty: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined || node.tag !== TEXT_INPUT) return
    const field: Field = { lastNativeText: null, eventCount: 0, stop: () => {} }
    fields.set(node, field)
    engine.setProp(node, 'text', valueOf(vnode))
    engine.setProp(node, 'latestEventCount', 0)
    field.stop = engine.setEventListener(node, 'topChange', event => {
      const native = (event as { nativeEvent?: { text?: string; eventCount?: number } })
        ?.nativeEvent
      const text = native?.text ?? ''
      // The text first and the count last, as React Native orders them.
      field.lastNativeText = text
      field.eventCount = native?.eventCount ?? field.eventCount + 1
      engine.setProp(node, 'latestEventCount', field.eventCount)
      const handler = handlersByNode.get(node)?.['input'] as Handler | undefined
      handler?.({ ...stubEvent(native), target: { value: text } })
    })
  }
  const update = (_oldVnode: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const field = fields.get(node)
    if (field === undefined) return
    const desired = valueOf(vnode)
    engine.setProp(node, 'text', desired)
    if (field.lastNativeText === null || field.lastNativeText === desired) return
    field.lastNativeText = desired
    // The `text` prop alone can be ignored as stale, so the text goes as a
    // command that carries the count. Sent once this draw has reached the
    // phone, then measured again: the field was sized for the old text.
    const count = field.eventCount
    afterCommit(() => {
      engine.dispatchCommand(node, 'setTextAndSelection', [count, desired, -1, -1])
      engine.remeasure(node)
    })
  }
  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    fields.get(node)?.stop()
    fields.delete(node)
  }
  return { create, update, destroy }
}

const SCREEN = 'screen'

/** Fills the stack. Screens sit on top of each other, one visible at a time. */
const SCREEN_FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const

/** No limit on where a swipe-back may start. An edge left out is 0 natively,
 *  and the stack refuses a swipe that starts beyond it. */
const UNLIMITED_SWIPE = { start: -1, end: -1, top: -1, bottom: -1 } as const

/** A native stack shows its last child. This flag is set once and never
 *  lowered: react-native-screens rejects a decrease inside a stack. */
const ACTIVE = 2

/** What every screen in a native stack needs before it joins the stack. */
const screenModule = (engine: Engine): Partial<Module> => ({
  create: (_empty: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined || node.tag !== SCREEN) return
    engine.setDefaultStyle(node, SCREEN_FILL)
    engine.setProp(node, 'activityState', ACTIVE)
    engine.setProp(node, 'gestureResponseDistance', UNLIMITED_SWIPE)
  },
})

export const makeModules = (
  engine: Engine,
  afterCommit: (job: () => void) => void,
): Array<Partial<Module>> => [
  propsModule(engine),
  classModule(engine),
  styleModule(engine),
  eventsModule(engine),
  textInputModule(engine, afterCommit),
  screenModule(engine),
  ...registeredModules().map(factory => factory(engine, afterCommit)),
]
