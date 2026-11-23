/**
 * Moves a view by a number that a native event carries, such as the
 * keyboard's height, without any JavaScript running per frame.
 *
 * React Native's animation module can connect an event to a view's position
 * on the native side. It is what `Animated.event` with `useNativeDriver`
 * uses. It is told to build a small chain:
 *
 *   the event's number -> an interpolation -> (plus a shift) -> the view's translateY
 *
 * The engine has the same thing built in (`engine.driveByEvent`), and the
 * dock uses that when the engine was started with the animation module. But
 * starting the engine with it also changes how every other animation in the
 * app is played. So the dock can be handed the module by itself instead
 * (`configureKeyboardDock({ nativeAnimated })`), and then this file builds
 * the chain, the way the engine's `native-drive.ts` does, and nothing else
 * in the app changes.
 */
import type { EventFeed, NativeAnimated, ScrollDrive, ScrollRange } from '@ng-native/fabric'

type Chain = Readonly<{
  value: number
  interpolation: number
  shift: number | null
  sum: number | null
  transform: number
  style: number
  props: number
  viewTag: number
  sourceTag: number
}>

export type EventDrive = ScrollDrive &
  Readonly<{
    /**
     * Try to connect, once both views have reached the phone. Safe to call
     * after every draw: it does nothing once connected.
     */
    connect: () => void
  }>

const sameRange = (a: ScrollRange, b: ScrollRange): boolean =>
  a.input.length === b.input.length &&
  a.input.every((value, index) => value === b.input[index]) &&
  a.output.every((value, index) => value === b.output[index])

/**
 * `tags` answers the two views' native tags, or null while either has not
 * been sent to the phone yet. `shift`, when given, is an amount added to the
 * movement that `shift()` can change later.
 */
export const driveByEvent = (
  native: NativeAnimated,
  tags: () => Readonly<{ view: number; source: number }> | null,
  feed: EventFeed,
  initialRange: ScrollRange,
  initialShift: number | null = null,
): EventDrive => {
  const { API } = native
  let range = initialRange
  let shift = initialShift
  let chain: Chain | null = null
  let isStopped = false

  const flush = (): void => API.flushQueue?.()

  const build = (value: number, viewTag: number, sourceTag: number): Chain => {
    const interpolation = native.generateNewNodeTag()
    API.createAnimatedNode(interpolation, {
      type: 'interpolation',
      inputRange: [...range.input],
      outputRange: [...range.output],
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    let shiftNode: number | null = null
    let sum: number | null = null
    if (shift !== null) {
      shiftNode = native.generateNewNodeTag()
      API.createAnimatedNode(shiftNode, { type: 'value', value: shift, offset: 0 })
      sum = native.generateNewNodeTag()
      API.createAnimatedNode(sum, { type: 'addition', input: [interpolation, shiftNode] })
    }
    const transform = native.generateNewNodeTag()
    API.createAnimatedNode(transform, {
      type: 'transform',
      transforms: [{ type: 'animated', property: 'translateY', nodeTag: sum ?? interpolation }],
    })
    // A style node in between, as React Native's own Animated builds it:
    // on iOS the props node reads its values from a style node.
    const style = native.generateNewNodeTag()
    API.createAnimatedNode(style, { type: 'style', style: { transform } })
    const props = native.generateNewNodeTag()
    API.createAnimatedNode(props, { type: 'props', props: { style } })
    API.connectAnimatedNodes(value, interpolation)
    if (shiftNode !== null && sum !== null) {
      API.connectAnimatedNodes(interpolation, sum)
      API.connectAnimatedNodes(shiftNode, sum)
      API.connectAnimatedNodes(sum, transform)
    } else {
      API.connectAnimatedNodes(interpolation, transform)
    }
    API.connectAnimatedNodes(transform, style)
    API.connectAnimatedNodes(style, props)
    API.connectAnimatedNodeToView(props, viewTag)
    return { value, interpolation, shift: shiftNode, sum, transform, style, props, viewTag, sourceTag }
  }

  /** Takes down everything but the value the events feed. */
  const takeDown = (built: Chain): void => {
    API.disconnectAnimatedNodeFromView(built.props, built.viewTag)
    API.dropAnimatedNode(built.props)
    API.dropAnimatedNode(built.style)
    API.dropAnimatedNode(built.transform)
    if (built.sum !== null) API.dropAnimatedNode(built.sum)
    if (built.shift !== null) API.dropAnimatedNode(built.shift)
    API.dropAnimatedNode(built.interpolation)
  }

  const connect = (): void => {
    if (isStopped || chain !== null) return
    const found = tags()
    if (found === null) return
    const value = native.generateNewNodeTag()
    API.createAnimatedNode(value, { type: 'value', value: 0, offset: 0 })
    for (const event of feed.events) {
      API.addAnimatedEventToView(found.source, event, {
        nativeEventPath: [...feed.path],
        animatedValueTag: value,
      })
    }
    chain = build(value, found.view, found.source)
    flush()
  }

  return {
    connect,
    update: next => {
      if (isStopped || sameRange(range, next)) return
      range = next
      if (chain === null) return
      // The value keeps the keyboard's height. Only what reads it is rebuilt.
      takeDown(chain)
      chain = build(chain.value, chain.viewTag, chain.sourceTag)
      flush()
    },
    shift: amount => {
      if (isStopped || shift === null || shift === amount) return
      shift = amount
      if (chain === null || chain.shift === null) return
      API.setAnimatedNodeValue(chain.shift, amount)
      flush()
    },
    stop: () => {
      if (isStopped) return
      isStopped = true
      if (chain === null) return
      takeDown(chain)
      for (const event of feed.events) {
        API.removeAnimatedEventFromView(chain.sourceTag, event, chain.value)
      }
      API.dropAnimatedNode(chain.value)
      chain = null
      flush()
    },
  }
}
