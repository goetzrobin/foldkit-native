/**
 * What an element carries besides its children: properties, classes, inline
 * styles and event handlers, written to engine nodes. A browser framework's
 * modules write the same things to DOM elements.
 *
 * Each behaviour here is a set of node hooks: called when an element's node
 * is made, when it is drawn again, and when it goes, with the element's data
 * (its props, attrs, class, style and on bags, and any marker a feature put
 * there). They know nothing of the view library that drew the element. The
 * Foldkit binding (`src/foldkit/modules.ts`) calls them from Foldkit's
 * updater.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'

import { PRESSED_STYLE } from '../style.js'

export type Bag = Record<string, unknown>

const EMPTY: Bag = {}

/** What a view library knows about one element besides its children. */
export type NodeData = Readonly<Record<string, unknown>>

export const EMPTY_DATA: NodeData = EMPTY

/** One of the element's bags: `props`, `attrs`, `class`, `style` or `on`. */
export const bagIn = (data: NodeData, key: 'props' | 'attrs' | 'class' | 'style' | 'on') =>
  (data[key] as Bag | undefined) ?? EMPTY

/**
 * What runs when an element's node is made, drawn again, or goes. `post`
 * runs once after a whole draw. Called for element nodes only.
 */
export type NodeHooks = Partial<{
  create: (node: EngineNode, data: NodeData) => void
  update: (node: EngineNode, before: NodeData, after: NodeData) => void
  destroy: (node: EngineNode, data: NodeData) => void
  post: () => void
}>

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


/**
 * Props the adapter consumes itself. A text field's `value` is kept in step
 * by `textInputHooks`, and `pressedStyle` is applied while a finger is down.
 */
const isFieldValue = (node: EngineNode, name: string): boolean =>
  (name === 'value' && node.tag === TEXT_INPUT) || name === PRESSED_STYLE

/** Properties and attributes both become native props. */
const propsHooks = (engine: Engine): NodeHooks => {
  const update = (node: EngineNode, oldData: NodeData, data: NodeData): void => {
    propsByNode.set(node, bagIn(data, 'props'))
    for (const key of ['props', 'attrs'] as const) {
      const before = bagIn(oldData, key)
      const after = bagIn(data, key)
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
  return { create: (node, data) => update(node, EMPTY, data), update }
}

const classHooks = (engine: Engine): NodeHooks => {
  const update = (node: EngineNode, oldData: NodeData, data: NodeData): void => {
    const before = bagIn(oldData, 'class')
    const after = bagIn(data, 'class')
    if (before === after) return
    for (const name in before) {
      if (before[name] && !after[name]) engine.removeClass(node, name)
    }
    for (const name in after) {
      if (after[name] && !before[name]) engine.addClass(node, name)
    }
  }
  return { create: (node, data) => update(node, EMPTY, data), update }
}

/** A CSS-style name and text value, as the native view reads it. */
const styleKey = (name: string): string =>
  name.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())

const styleValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim())
  return match ? Number(match[1]) : value
}

const styleHooks = (engine: Engine): NodeHooks => {
  const update = (node: EngineNode, oldData: NodeData, data: NodeData): void => {
    const before = bagIn(oldData, 'style')
    const after = bagIn(data, 'style')
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
  return { create: (node, data) => update(node, EMPTY, data), update }
}

export type Handler = (event: unknown) => void
type Stops = Map<string, () => void>

const stopsByNode = new WeakMap<EngineNode, Stops>()
export const handlersByNode = new WeakMap<EngineNode, Bag>()

/** An engine event name for a handler name: `scroll` is `topScroll`. */
const topLevelType = (name: string): string =>
  'top' + name.charAt(0).toUpperCase() + name.slice(1)

type CustomEventMaker = new (name: string, init: { detail: unknown }) => unknown

/**
 * Custom-event handlers (Foldkit's among them) check `event instanceof CustomEvent`. Where
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

/** How far a finger may drift, in points, and still count as a press. */
const PRESS_SLOP = 10

type Point = Readonly<{ x: number; y: number }>

const pointOf = (event: unknown): Point | undefined => {
  const native = (event as { nativeEvent?: { pageX?: number; pageY?: number } })?.nativeEvent
  return typeof native?.pageX === 'number' && typeof native?.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : undefined
}

/** The newest props drawn on a node, for the style to return to after a press. */
const propsByNode = new WeakMap<EngineNode, Bag>()

const showPressed = (engine: Engine, node: EngineNode, isPressed: boolean): void => {
  const props = propsByNode.get(node) ?? EMPTY
  const pressedStyle = props[PRESSED_STYLE]
  if (!isPlain(pressedStyle)) return
  const base = isPlain(props['style']) ? props['style'] : undefined
  engine.setProp(node, 'style', isPressed ? { ...base, ...pressedStyle } : base)
  // A press happens between draws, so this change is sent now.
  engine.commit()
}

/**
 * `click` has no native event of its own: a press is a touch that starts on
 * a view and ends there without drifting away.
 *
 * - The finger goes down: the view shows its `pressedStyle`, if it has one.
 * - The finger drifts more than a few points: the press is off. This is also
 *   what keeps a scroll that starts on a row from pressing the row.
 * - Something else takes the touch (a scroll view starts scrolling): off.
 * - The finger lifts while the press is still on: the handler runs.
 */
const listenForPress = (engine: Engine, node: EngineNode): (() => void) => {
  let start: Point | undefined
  let isOn = false
  const end = (): void => {
    if (!isOn) return
    isOn = false
    showPressed(engine, node, false)
  }
  return engine.setResponder(node, {
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => true,
    onResponderGrant: event => {
      start = pointOf(event)
      isOn = true
      showPressed(engine, node, true)
    },
    onResponderMove: event => {
      const now = pointOf(event)
      if (!isOn || start === undefined || now === undefined) return
      if (Math.hypot(now.x - start.x, now.y - start.y) > PRESS_SLOP) end()
    },
    onResponderTerminate: end,
    onResponderRelease: event => {
      const wasOn = isOn
      end()
      if (!wasOn) return
      const handler = handlersByNode.get(node)?.['click'] as Handler | undefined
      handler?.(customEvent('click', (event as { nativeEvent?: unknown })?.nativeEvent))
    },
  })
}

const eventsHooks = (engine: Engine): NodeHooks => {
  const update = (node: EngineNode, oldData: NodeData, data: NodeData): void => {
    const before = bagIn(oldData, 'on')
    const after = bagIn(data, 'on')
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
  const destroy = (node: EngineNode): void => {
    const stops = stopsByNode.get(node)
    if (stops === undefined) return
    for (const stop of stops.values()) stop()
    stopsByNode.delete(node)
    handlersByNode.delete(node)
  }
  return { create: (node, data) => update(node, EMPTY, data), update, destroy }
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

const valueOf = (data: NodeData): string => {
  const value = bagIn(data, 'attrs')['value'] ?? bagIn(data, 'props')['value']
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
const textInputHooks = (
  engine: Engine,
  afterCommit: (job: () => void) => void,
): NodeHooks => {
  const create = (node: EngineNode, data: NodeData): void => {
    if (node.tag !== TEXT_INPUT) return
    const field: Field = { lastNativeText: null, eventCount: 0, stop: () => {} }
    fields.set(node, field)
    engine.setProp(node, 'text', valueOf(data))
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
  const update = (node: EngineNode, _oldData: NodeData, data: NodeData): void => {
    const field = fields.get(node)
    if (field === undefined) return
    const desired = valueOf(data)
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
  const destroy = (node: EngineNode): void => {
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
const screenHooks = (engine: Engine): NodeHooks => ({
  create: (node: EngineNode): void => {
    if (node.tag !== SCREEN) return
    engine.setDefaultStyle(node, SCREEN_FILL)
    engine.setProp(node, 'activityState', ACTIVE)
    engine.setProp(node, 'gestureResponseDistance', UNLIMITED_SWIPE)
  },
})

/** The behaviours every element has, in the order they run. */
export const makeNodeHooks = (
  engine: Engine,
  afterCommit: (job: () => void) => void,
): Array<NodeHooks> => [
  propsHooks(engine),
  classHooks(engine),
  styleHooks(engine),
  eventsHooks(engine),
  textInputHooks(engine, afterCommit),
  screenHooks(engine),
]
