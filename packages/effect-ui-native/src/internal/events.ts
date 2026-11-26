/**
 * Native events as finished events with plain payloads.
 *
 * A view names an event the way the vocabulary does (`scroll`, `changeText`,
 * `layout`). This file says which native event that is (`topScroll`) and
 * builds the payload a handler gets: plain numbers and text, never the
 * phone's own event object, so a test can fire one with a literal.
 *
 * A name that is not in the table is a native view's own event: `dismissed`
 * is `topDismissed`, and the payload is a copy of what the phone sent.
 */

/** Where a scroll view is, and how big it and its content are, in points. */
export type ScrollPayload = Readonly<{
  x: number
  y: number
  contentWidth: number
  contentHeight: number
  width: number
  height: number
  /** A finger did it. False for a scroll the program made. */
  byUser: boolean
}>

export type LayoutPayload = Readonly<{ x: number; y: number; width: number; height: number }>

export type TextPayload = Readonly<{ text: string }>

type Native = Record<string, unknown> | undefined

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

const scrollPayload = (native: Native): ScrollPayload => {
  const offset = native?.['contentOffset'] as { x?: number; y?: number } | undefined
  const content = native?.['contentSize'] as { width?: number; height?: number } | undefined
  const frame = native?.['layoutMeasurement'] as { width?: number; height?: number } | undefined
  return {
    x: num(offset?.x),
    y: num(offset?.y),
    contentWidth: num(content?.width),
    contentHeight: num(content?.height),
    width: num(frame?.width),
    height: num(frame?.height),
    byUser: native?.['responderIgnoreScroll'] !== true,
  }
}

const layoutPayload = (native: Native): LayoutPayload => {
  const layout = native?.['layout'] as Partial<LayoutPayload> | undefined
  return { x: num(layout?.x), y: num(layout?.y), width: num(layout?.width), height: num(layout?.height) }
}

const textPayload = (native: Native): TextPayload => ({
  text: typeof native?.['text'] === 'string' ? native['text'] : '',
})

const nothing = (): Readonly<Record<string, never>> => ({})

/** A copy of what the phone sent, without the view's number. */
const copyOf = (native: Native): Readonly<Record<string, unknown>> => {
  const { target: _target, ...rest } = native ?? {}
  return rest
}

export type Source = Readonly<{
  /** The key in the element's `on` bag: the engine listens for `top` + this, capitalised. */
  on: string
  payload: (native: Native) => unknown
  /** Leave the event out when this says so. */
  accepts?: (native: Native) => boolean
}>

const atRest = (native: Native): boolean => {
  const velocity = native?.['velocity'] as { x?: number; y?: number } | undefined
  return Math.abs(num(velocity?.x)) < 0.01 && Math.abs(num(velocity?.y)) < 0.01
}

const TABLE: Readonly<Record<string, ReadonlyArray<Source>>> = {
  scroll: [{ on: 'scroll', payload: scrollPayload }],
  scrollBeginDrag: [{ on: 'scrollBeginDrag', payload: scrollPayload }],
  scrollEndDrag: [{ on: 'scrollEndDrag', payload: scrollPayload }],
  momentumScrollEnd: [{ on: 'momentumScrollEnd', payload: scrollPayload }],
  // The list came to rest: the glide ended, or the finger lifted with no glide to follow.
  scrollEnd: [
    { on: 'momentumScrollEnd', payload: scrollPayload },
    { on: 'scrollEndDrag', payload: scrollPayload, accepts: atRest },
  ],
  layout: [{ on: 'layout', payload: layoutPayload }],
  submit: [{ on: 'submitEditing', payload: textPayload }],
  focus: [{ on: 'focus', payload: nothing }],
  blur: [{ on: 'blur', payload: nothing }],
}

/** The native events behind a vocabulary event. */
export const sourcesOf = (name: string): ReadonlyArray<Source> =>
  TABLE[name] ?? [{ on: name, payload: copyOf }]

/** Handled by the press recogniser (`touch.ts`), not by a native event of their own. */
export const isTouchEvent = (name: string): name is 'press' | 'longPress' =>
  name === 'press' || name === 'longPress'

/** A text field's text changed. Handled with the field's echo (`nodes.ts`). */
export const CHANGE_TEXT = 'changeText'

/** Events React Native sends up the tree. The host stops them at the element that handled them. */
export const nativeOf = (event: unknown): Native => {
  const detail = (event as { detail?: unknown } | undefined)?.detail
  return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : undefined
}
