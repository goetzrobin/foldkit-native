/**
 * Every operation of the Host, called the way Effect UI's renderer calls
 * them, and checked against what reached the simulated phone.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { describe, expect, it } from 'vitest'

import { NativeHost } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'

const start = (options: NativeHost.SurfaceOptions = {}) => {
  registerPlatformComponents('ios')
  const fabric = createFakeFabric()
  const surface = NativeHost.makeSurface(fabric, 1, { dev: false, ...options })
  const { host } = surface
  const byId = (id: string): FakeFabricNode => {
    const found = NativeTest.flatten(fabric.committed).find(node => node.props['testID'] === id)
    if (found === undefined) throw new Error(`No view with testID ${id}`)
    return found
  }
  return { fabric, surface, host, byId, root: surface.container }
}

const noDispatch = () => false

describe('NativeHost as a Renderer.Host', () => {
  it('says what it shows: the native vocabulary, controlled text, and mounts', () => {
    const { host } = start()
    expect(host.elements).toEqual(['native'])
    expect([...host.controlled]).toEqual(['value'])
    expect(host.runsMounts).toBe(true)
    expect(host.head).toBeUndefined()
    expect(host.hydration).toBeUndefined()
  })

  it('createElement, setProp, insertBefore and commit draw a view, in one commit', () => {
    const { fabric, host, byId, root } = start()
    const before = fabric.calls.completeRoot
    const view = host.createElement('view')
    host.setProp(view, 'testID', 'box')
    host.setProp(view, 'style', { padding: 8, backgroundColor: '#ff0000' })
    host.insertBefore(root, view, undefined)
    // Nothing reaches the phone before the commit.
    expect(fabric.calls.completeRoot).toBe(before)
    host.commit?.()
    expect(fabric.calls.completeRoot).toBe(before + 1)
    expect(byId('box').viewName).toBe('View')
    expect(byId('box').props['padding']).toBe(8)
  })

  it('createText and setText draw and change words inside a text element', () => {
    const { host, byId, root } = start()
    const text = host.createElement('text')
    host.setProp(text, 'testID', 'words')
    const words = host.createText('one')
    host.insertBefore(text, words, undefined)
    host.insertBefore(root, text, undefined)
    host.commit?.()
    expect(NativeTest.textOf(byId('words'))).toBe('one')
    host.setText(words, 'two')
    host.commit?.()
    expect(NativeTest.textOf(byId('words'))).toBe('two')
  })

  it('setAttr sets a native prop from text, and undefined takes it away', () => {
    const { host, byId, root } = start()
    const view = host.createElement('view')
    host.setProp(view, 'testID', 'box')
    host.setAttr(view, 'accessibilityLabel', 'Save')
    host.insertBefore(root, view, undefined)
    host.commit?.()
    expect(byId('box').props['accessibilityLabel']).toBe('Save')
    host.setAttr(view, 'accessibilityLabel', undefined, 'Save')
    host.commit?.()
    expect(byId('box').props['accessibilityLabel'] ?? null).toBeNull()
  })

  it('setProp with undefined takes a prop away, and an equal style object is no work', () => {
    const { fabric, host, byId, root } = start()
    const view = host.createElement('view')
    host.setProp(view, 'testID', 'box')
    host.setProp(view, 'nativeID', 'n1')
    host.setProp(view, 'style', { opacity: 0.5 })
    host.insertBefore(root, view, undefined)
    host.commit?.()
    const clones = fabric.calls.cloneWithProps + fabric.calls.cloneWithChildrenAndProps
    // A view builds a new style object on every draw.
    host.setProp(view, 'style', { opacity: 0.5 })
    host.commit?.()
    expect(fabric.calls.cloneWithProps + fabric.calls.cloneWithChildrenAndProps).toBe(clones)
    host.setProp(view, 'nativeID', undefined)
    host.commit?.()
    expect(byId('box').props['nativeID'] ?? null).toBeNull()
  })

  it('insertBefore with a reference, parentOf, nextOf and remove keep the order of children', () => {
    const { host, byId, root } = start()
    const parent = host.createElement('view')
    host.setProp(parent, 'testID', 'parent')
    const make = (id: string) => {
      const node = host.createElement('view')
      host.setProp(node, 'testID', id)
      // Kept as a native view, so the test can find it.
      host.setProp(node, 'collapsable', false)
      return node
    }
    const [a, b, c] = [make('a'), make('b'), make('c')]
    host.insertBefore(parent, a, undefined)
    host.insertBefore(parent, c, undefined)
    host.insertBefore(parent, b, c)
    host.insertBefore(root, parent, undefined)
    host.commit?.()
    const ids = () => byId('parent').children.map(child => child.props['testID'])
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(host.parentOf(b)).toBe(parent)
    expect(host.nextOf(a)).toBe(b)
    expect(host.nextOf(c)).toBeUndefined()
    // A move is an insert of a node that is already there.
    host.insertBefore(parent, c, a)
    host.commit?.()
    expect(ids()).toEqual(['c', 'a', 'b'])
    host.remove(a)
    expect(host.parentOf(a)).toBeUndefined()
    host.commit?.()
    expect(ids()).toEqual(['c', 'b'])
  })

  it('a removed element is destroyed at the commit, with its listeners', () => {
    const { surface, host, root } = start()
    const view = host.createElement('pressable')
    host.setEvents(view, { press: 'Pressed', layout: 'LaidOut' }, noDispatch, {})
    host.insertBefore(root, view, undefined)
    host.commit?.()
    expect(surface.stats.live).toBe(1)
    expect(surface.stats.wired).toBe(1)
    expect(surface.stats.listeners).toBe(1)
    host.remove(view)
    host.commit?.()
    expect(surface.stats.live).toBe(0)
    expect(surface.stats.wired).toBe(0)
    expect(surface.stats.listeners).toBe(0)
    expect(surface.stats.destroyed).toBe(1)
  })

  it('setEvents stores handlers as data and dispatches the same handler value back', () => {
    const { fabric, host, byId, root } = start()
    const seen: Array<[string, unknown, unknown]> = []
    const handler = { message: 'Pressed' }
    const view = host.createElement('pressable')
    host.setProp(view, 'testID', 'button')
    host.setEvents(
      view,
      { press: handler },
      (event, given, payload) => {
        seen.push([event, given, payload])
        return true
      },
      {},
    )
    host.insertBefore(root, view, undefined)
    host.commit?.()
    const touch = (pageX: number) => ({ identifier: 0, target: byId('button').reactTag, pageX, pageY: 5, touches: [], changedTouches: [] })
    fabric.emit(byId('button'), 'topTouchStart', { ...touch(3), touches: [touch(3)] })
    fabric.emit(byId('button'), 'topTouchEnd', touch(3))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.[0]).toBe('press')
    expect(seen[0]?.[1]).toBe(handler)
    expect(seen[0]?.[2]).toEqual({ x: 3, y: 5 })
    // New handlers for the same events: no new listener, and the new value is used.
    const next = { message: 'PressedAgain' }
    host.setEvents(view, { press: next }, (_event, given) => (seen.push(['again', given, undefined]), true), {})
    host.commit?.()
    fabric.emit(byId('button'), 'topTouchStart', { ...touch(3), touches: [touch(3)] })
    fabric.emit(byId('button'), 'topTouchEnd', touch(3))
    expect(seen[1]?.[1]).toBe(next)
  })

  it('a scroll view gets one content view, children go inside it, and contentStyle styles it', () => {
    const { host, byId, root } = start()
    const scroll = host.createElement('scrollView')
    host.setProp(scroll, 'testID', 'scroll')
    host.setProp(scroll, 'contentStyle', { padding: 12 })
    const row = host.createElement('view')
    host.setProp(row, 'testID', 'row')
    host.setProp(row, 'collapsable', false)
    host.insertBefore(scroll, row, undefined)
    host.insertBefore(root, scroll, undefined)
    host.commit?.()
    const committed = byId('scroll')
    expect(committed.viewName).toContain('ScrollView')
    expect(committed.children).toHaveLength(1)
    expect(committed.children[0]?.props['collapsable']).toBe(false)
    expect(committed.children[0]?.props['padding']).toBe(12)
    expect(committed.children[0]?.children[0]?.props['testID']).toBe('row')
    // The renderer sees the scroll view as the row's parent, never the content view.
    expect(host.parentOf(row)).toBe(scroll)
  })

  it('createContainer holds the nodes of a kept child off screen, and gives them back', () => {
    const { surface, host, byId, root } = start()
    const view = host.createElement('view')
    host.setProp(view, 'testID', 'kept')
    host.setProp(view, 'collapsable', false)
    const other = host.createElement('view')
    host.insertBefore(root, view, undefined)
    host.commit?.()
    const shelf = host.createContainer?.() as NativeHost.NativeNode
    host.insertBefore(shelf, view, undefined)
    host.insertBefore(shelf, other, undefined)
    expect(host.parentOf(view)).toBe(shelf)
    expect(host.nextOf(view)).toBe(other)
    host.commit?.()
    expect(() => byId('kept')).toThrow()
    // Still alive: it was parked, not destroyed.
    expect(surface.stats.destroyed).toBe(0)
    host.insertBefore(root, view, undefined)
    host.commit?.()
    expect(byId('kept')).toBeDefined()
  })

  it('tags of the vocabulary become the native views', () => {
    const { host, byId, root } = start()
    const expected: Record<string, string> = {
      view: 'View',
      pressable: 'View',
      text: 'Paragraph',
      textInput: 'TextInput',
      image: 'Image',
    }
    for (const tag in expected) {
      const node = host.createElement(tag)
      host.setProp(node, 'testID', tag)
      host.setProp(node, 'collapsable', false)
      host.insertBefore(root, node, undefined)
    }
    host.commit?.()
    for (const tag in expected) expect(byId(tag).viewName).toBe(expected[tag])
  })

  it('dispose takes everything away and leaves no listener', () => {
    const { surface, host, root, fabric } = start()
    const scroll = host.createElement('scrollView')
    host.setEvents(scroll, { scroll: 'Scrolled', scrollEnd: 'Ended' }, noDispatch, {})
    const row = host.createElement('pressable')
    host.setEvents(row, { press: 'Pressed', longPress: 'Held' }, noDispatch, {})
    host.insertBefore(scroll, row, undefined)
    const field = host.createElement('textInput')
    host.setProp(field, 'value', 'x')
    host.setEvents(field, { changeText: 'Changed', focus: 'Focused' }, noDispatch, {})
    host.insertBefore(root, scroll, undefined)
    host.insertBefore(root, field, undefined)
    host.commit?.()
    expect(surface.stats.live).toBe(3)
    expect(surface.stats.listeners).toBeGreaterThan(0)
    surface.close()
    expect(surface.stats.live).toBe(0)
    expect(surface.stats.listeners).toBe(0)
    expect(surface.stats.wired).toBe(0)
    // Only the surface's own full-screen view is left, empty.
    expect(NativeTest.flatten(fabric.committed)).toHaveLength(1)
  })
})
