/**
 * A stand-in for React Native's animation module, for tests. It records what
 * the engine asks the phone to build, so a test can check which view is
 * connected to which native event and how far it will move.
 *
 * On a phone, the engine connects a native event (the keyboard moved, with a
 * height) to a view's position through a small graph of nodes: a value fed
 * by the event, an interpolation of it, and a transform on the view.
 */
import type { NativeAnimated } from '@ng-native/fabric'

type Call = readonly [name: string, ...args: Array<unknown>]
type Config = Record<string, unknown> & { type?: string }

export const makeNativeAnimated = () => {
  let next = 1
  const calls: Array<Call> = []
  const record =
    (name: string) =>
    (...args: Array<unknown>): void => {
      calls.push([name, ...args])
    }
  const native: NativeAnimated = {
    generateNewNodeTag: () => next++,
    API: {
      createAnimatedNode: record('create'),
      connectAnimatedNodes: record('connect'),
      disconnectAnimatedNodes: record('disconnect'),
      connectAnimatedNodeToView: record('toView'),
      disconnectAnimatedNodeFromView: record('fromView'),
      dropAnimatedNode: record('drop'),
      addAnimatedEventToView: record('event'),
      removeAnimatedEventFromView: record('removeEvent'),
      setAnimatedNodeValue: record('set'),
      flushQueue: record('flush'),
    },
  }

  const named = (name: string): Array<Call> => calls.filter(call => call[0] === name)

  /** The native events now feeding a value, as `[viewTag, eventName]`. */
  const events = (): Array<readonly [number, string]> => {
    const live: Array<readonly [number, string, unknown]> = []
    for (const [name, view, event, detail] of calls) {
      if (name === 'event') {
        live.push([
          view as number,
          event as string,
          (detail as { animatedValueTag: number }).animatedValueTag,
        ])
      }
      if (name === 'removeEvent') {
        const at = live.findIndex(
          each => each[0] === view && each[1] === event && each[2] === detail,
        )
        if (at >= 0) live.splice(at, 1)
      }
    }
    return live.map(([view, event]) => [view, event] as const)
  }

  /** The view tags the phone is moving now. */
  const drivenViews = (): Array<number> => {
    const live = new Map<unknown, unknown>()
    for (const [name, props, view] of calls) {
      if (name === 'toView') live.set(view, props)
      if (name === 'fromView' && live.get(view) === props) live.delete(view)
    }
    return [...live.keys()] as Array<number>
  }

  /**
   * How far the phone moves a view up or down when the event carries
   * `value`: the `translateY` the graph connected to that view comes to.
   */
  const translateY = (viewTag: number, value: number): number | undefined => {
    const configs = new Map<unknown, Config>()
    const values = new Map<unknown, number>()
    const parents = new Map<unknown, Array<unknown>>()
    let props: unknown
    for (const [name, a, b] of calls) {
      if (name === 'create') {
        configs.set(a, b as Config)
        if ((b as Config).type === 'value') values.set(a, (b as { value: number }).value)
      }
      if (name === 'set') values.set(a, b as number)
      if (name === 'connect') parents.set(b, [...(parents.get(b) ?? []), a])
      if (name === 'disconnect') parents.set(b, (parents.get(b) ?? []).filter(at => at !== a))
      if (name === 'toView' && b === viewTag) props = a
      if (name === 'fromView' && b === viewTag && props === a) props = undefined
    }
    if (props === undefined) return undefined
    const fed = new Set<unknown>()
    for (const [, , , detail] of named('event')) {
      fed.add((detail as { animatedValueTag: number }).animatedValueTag)
    }
    const number = (tag: unknown): number => {
      const config = configs.get(tag)
      if (config?.type === 'value') return fed.has(tag) ? value : (values.get(tag) ?? 0)
      if (config?.type === 'addition') {
        return (config['input'] as Array<unknown>).reduce<number>((sum, at) => sum + number(at), 0)
      }
      if (config?.type !== 'interpolation') throw new Error(`No value for node ${String(tag)}`)
      const [parent] = parents.get(tag) ?? []
      const input = config['inputRange'] as Array<number>
      const output = config['outputRange'] as Array<number>
      const x = number(parent)
      const [x0, x1] = [input[0] as number, input[input.length - 1] as number]
      const [y0, y1] = [output[0] as number, output[output.length - 1] as number]
      if (x <= x0) return y0
      if (x >= x1) return y1
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
    const styleTag = (configs.get(props)?.['props'] as { style?: unknown } | undefined)?.style
    const transformTag = (configs.get(styleTag)?.['style'] as { transform?: unknown } | undefined)
      ?.transform
    const entries = (configs.get(transformTag)?.['transforms'] ?? []) as Array<{
      property: string
      nodeTag?: unknown
      value?: number
    }>
    let moved = 0
    for (const entry of entries) {
      if (entry.property !== 'translateY') continue
      moved += entry.nodeTag === undefined ? (entry.value ?? 0) : number(entry.nodeTag)
    }
    return moved
  }

  return { native, calls, named, events, drivenViews, translateY }
}
