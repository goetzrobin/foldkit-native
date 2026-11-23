/**
 * The virtualised list and pull to refresh, on the simulated phone.
 *
 * The program here is small on purpose: 5,000 rows, a press that marks a row,
 * buttons that change the items, and a count of how often the view ran, so a
 * test can prove that scrolling does not run it.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { style, text, view as box } from '../src/index.js'
import {
  Heights,
  chooseWindow,
  list,
  listRowCount,
  refreshScrollView,
  scrollListToIndex,
} from '../src/list/index.js'
import {
  type Phone,
  byTestId,
  flatten,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

const Item = Schema.Struct({ id: Schema.Number, label: Schema.String })
type Item = typeof Item.Type

const Model = Schema.Struct({
  items: Schema.Array(Item),
  pressed: Schema.Array(Schema.Number),
  endsReached: Schema.Number,
  isRefreshing: Schema.Boolean,
  pulls: Schema.Number,
  nextId: Schema.Number,
  isListShown: Schema.Boolean,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedRow: { id: Schema.Number },
  ReachedEnd: {},
  PressedPrepend: {},
  PressedRemoveFirst: {},
  PressedReverse: {},
  PressedRename: {},
  PressedJump: {},
  PressedHide: {},
  CompletedJump: {},
  PulledToRefresh: {},
  PressedFinishRefresh: {},
})
type Message = typeof Message.Type

const Jump = Command.define('Jump', {
  args: { index: Schema.Number },
  messages: [Message.CompletedJump],
  execute: ({ index }) =>
    scrollListToIndex('rows', index).pipe(Effect.as(Message.CompletedJump())),
})

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedRow: ({ id }) => ({
      model: modifyFields(model, { pressed: pressed => [...pressed, id] }),
    }),
    ReachedEnd: () => ({
      model: modifyFields(model, { endsReached: count => count + 1 }),
    }),
    PressedPrepend: () => ({
      model: modifyFields(model, {
        items: items => [{ id: model.nextId, label: `New ${model.nextId}` }, ...items],
        nextId: nextId => nextId + 1,
      }),
    }),
    PressedRemoveFirst: () => ({
      model: modifyFields(model, { items: items => items.slice(1) }),
    }),
    PressedReverse: () => ({
      model: modifyFields(model, { items: items => [...items].reverse() }),
    }),
    PressedRename: () => ({
      model: modifyFields(model, {
        items: items =>
          items.map(item => (item.id === 0 ? { ...item, label: 'Renamed' } : item)),
      }),
    }),
    PressedJump: () => ({ model, commands: [Jump({ index: 2500 })] }),
    PressedHide: () => ({ model: modifyFields(model, { isListShown: () => false }) }),
    CompletedJump: () => ({ model }),
    PulledToRefresh: () => ({
      model: modifyFields(model, {
        isRefreshing: () => true,
        pulls: pulls => pulls + 1,
      }),
    }),
    PressedFinishRefresh: () => ({
      model: modifyFields(model, { isRefreshing: () => false }),
    }),
  })

const COUNT = 5000
const ESTIMATE = 50
/** The height the pretend phone gives a row: rows differ, and none is 50. */
const realHeight = (id: number): number => 40 + (id % 3) * 20

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    items: Array.from({ length: COUNT }, (_unused, id) => ({ id, label: `Row ${id}` })),
    pressed: [],
    endsReached: 0,
    isRefreshing: false,
    pulls: 0,
    nextId: 100000,
    isListShown: true,
  },
})

const button = (h: HtmlBuilder<Message>, id: string, message: Message): Html =>
  box([h.Attribute('testID', id), h.OnClick(message)], [text([], [id])])

let viewRuns = 0
let rowRuns = 0

const makeView =
  (platform: string) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    viewRuns += 1
    return box(
      [style({ flex: 1 })],
      [
        text([h.Attribute('testID', 'status')], [
          `pressed:${model.pressed.join(',')} ends:${model.endsReached} pulls:${model.pulls}`,
        ]),
        listRowCount('rows', [h.Attribute('testID', 'row-count')]),
        button(h, 'prepend', Message.PressedPrepend()),
        button(h, 'remove-first', Message.PressedRemoveFirst()),
        button(h, 'reverse', Message.PressedReverse()),
        button(h, 'rename', Message.PressedRename()),
        button(h, 'jump', Message.PressedJump()),
        button(h, 'hide', Message.PressedHide()),
        button(h, 'finish-refresh', Message.PressedFinishRefresh()),
        model.isListShown
          ? list(h, {
              id: 'rows',
              items: model.items,
              key: item => item.id,
              estimatedRowHeight: ESTIMATE,
              row: item => {
                rowRuns += 1
                return box(
                  [
                    h.Attribute('testID', `row-${item.id}`),
                    h.OnClick(Message.PressedRow({ id: item.id })),
                  ],
                  [text([], [item.label])],
                )
              },
              onEndReached: () => Message.ReachedEnd(),
              refresh: {
                platform,
                refreshing: model.isRefreshing,
                onRefresh: () => Message.PulledToRefresh(),
              },
              attributes: [h.Attribute('testID', 'list'), style({ flex: 1 })],
            })
          : h.empty,
        refreshScrollView(
          {
            platform,
            refreshing: model.isRefreshing,
            onRefresh: () => Message.PulledToRefresh(),
          },
          [h.Attribute('testID', 'plain-scroll'), style({ flex: 1, backgroundColor: '#fff' })],
          [text([], ['A plain scroll view'])],
        ),
      ],
    )
  }

const VIEWPORT = 600

/** The scroll view's content view, then the canvas the list module owns. */
const canvasOf = (phone: Phone): FakeFabricNode => {
  const content = byTestId(phone.fabric, 'list').children.at(-1)
  const canvas = content?.children[0]
  if (canvas === undefined) throw new Error('The list has no canvas')
  return canvas
}

const rowIds = (phone: Phone): number[] =>
  flatten([canvasOf(phone)])
    .map(node => node.props['testID'])
    .filter((id): id is string => typeof id === 'string' && id.startsWith('row-'))
    .map(id => Number(id.slice(4)))

/** The phone lays out every row it has not reported yet, as it does after a commit. */
const layOutRows = async (phone: Phone, heightOf = realHeight): Promise<void> => {
  for (let round = 0; round < 4; round++) {
    for (const wrapper of canvasOf(phone).children.slice(1)) {
      const id = flatten([wrapper])
        .map(node => node.props['testID'])
        .find((testId): testId is string => typeof testId === 'string')
      if (id === undefined) continue
      phone.fabric.emit(wrapper, 'topLayout', {
        layout: { x: 0, y: 0, width: 320, height: heightOf(Number(id.slice(4))) },
      })
    }
    await settle()
  }
}

const layOutList = async (phone: Phone): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'list'), 'topLayout', {
    layout: { x: 0, y: 0, width: 320, height: VIEWPORT },
  })
  await settle()
}

const scrollTo = (phone: Phone, y: number): void => {
  phone.fabric.emit(byTestId(phone.fabric, 'list'), 'topScroll', {
    contentOffset: { x: 0, y },
    layoutMeasurement: { width: 320, height: VIEWPORT },
    contentSize: { width: 320, height: Number(canvasOf(phone).props['height']) },
  })
}

const status = (phone: Phone): string => textOf(byTestId(phone.fabric, 'status'))

describe('the arithmetic of a long list', () => {
  it('finds where a row starts and which row is at a point', () => {
    const heights = new Heights([10, 20, 30, 40])
    expect(heights.total()).toBe(100)
    expect(heights.offsetOf(2)).toBe(30)
    expect(heights.indexAt(0)).toBe(0)
    expect(heights.indexAt(29)).toBe(1)
    expect(heights.indexAt(30)).toBe(2)
    expect(heights.indexAt(1000)).toBe(3)
    heights.set(0, 50)
    expect(heights.offsetOf(2)).toBe(70)
    expect(heights.indexAt(49)).toBe(0)
  })

  it('keeps the rows drawn until half the margin is used up', () => {
    const heights = new Heights(Array.from({ length: 1000 }, () => 50))
    const first = chooseWindow(heights, 0, 600, 600, { first: 0, end: 0 })
    expect(first).toEqual({ first: 0, end: 25 })
    expect(chooseWindow(heights, 250, 600, 600, first)).toBe(first)
    expect(chooseWindow(heights, 400, 600, 600, first)).toEqual({ first: 0, end: 33 })
    expect(chooseWindow(heights, 20000, 600, 600, first)).toEqual({ first: 388, end: 425 })
  })
})

describe.each(['ios', 'android'] as const)('a long list on the simulated phone (%s)', platform => {
  let phone: Phone
  let handle: { dispose: () => void }

  beforeEach(async () => {
    viewRuns = 0
    rowRuns = 0
    phone = startPhone(platform)
    handle = Runtime.embed(
      Runtime.makeElement({
        Model,
        init,
        update,
        view: makeView(platform),
        container: phone.surface.container,
      }),
    )
    await settle()
    await layOutList(phone)
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('draws a scroll view with one content view and a canvas as tall as all rows', () => {
    const scroll = byTestId(phone.fabric, 'list')
    expect(scroll.viewName).toBe('ScrollView')
    expect(scroll.props['scrollEventThrottle']).toBe(16)
    const content = scroll.children.at(-1)
    expect(content?.props['collapsable']).toBe(false)
    expect(content?.children).toHaveLength(1)
    expect(canvasOf(phone).props['collapsable']).toBe(false)
    expect(canvasOf(phone).props['height']).toBe(COUNT * ESTIMATE)
  })

  it('draws only the rows near the screen, out of 5,000', () => {
    const ids = rowIds(phone)
    expect(ids[0]).toBe(0)
    // A 600 point screen of 50 point rows, and as much again drawn ahead.
    expect(ids.length).toBeGreaterThanOrEqual(12)
    expect(ids.length).toBeLessThan(40)
    expect(rowRuns).toBeLessThan(120)
    expect(textOf(byTestId(phone.fabric, 'row-count'))).toBe(
      `${ids.length} row views (rows 1 to ${ids.length} of 5000)`,
    )
  })

  it('changes the rows on scroll without running the view or sending a Message', async () => {
    const viewRunsBefore = viewRuns
    const commitsBefore = phone.fabric.calls.completeRoot
    scrollTo(phone, 100000)
    // No waiting: the rows are committed inside the scroll event itself.
    const ids = rowIds(phone)
    expect(ids).toContain(2000)
    expect(ids).not.toContain(0)
    expect(ids.length).toBeLessThan(40)
    expect(phone.fabric.calls.completeRoot).toBe(commitsBefore + 1)
    // The spacer stands in for the rows above.
    expect(canvasOf(phone).children[0]?.props['height']).toBe((ids[0] ?? 0) * ESTIMATE)
    expect(textOf(byTestId(phone.fabric, 'row-count'))).toContain(`rows ${(ids[0] ?? 0) + 1} to`)
    await settle()
    expect(viewRuns).toBe(viewRunsBefore)
  })

  it('does not commit again for a scroll the drawn rows already cover', () => {
    scrollTo(phone, 100000)
    const commitsBefore = phone.fabric.calls.completeRoot
    const rowRunsBefore = rowRuns
    scrollTo(phone, 100050)
    scrollTo(phone, 100100)
    expect(phone.fabric.calls.completeRoot).toBe(commitsBefore)
    expect(rowRuns).toBe(rowRunsBefore)
  })

  it('builds only the rows that are new when the window moves', () => {
    scrollTo(phone, 100000)
    const before = rowIds(phone)
    const rowRunsBefore = rowRuns
    scrollTo(phone, 100400)
    const after = rowIds(phone)
    const fresh = after.filter(id => !before.includes(id))
    expect(fresh.length).toBeGreaterThan(0)
    expect(rowRuns - rowRunsBefore).toBe(fresh.length)
  })

  it('sends a Message when a row that appeared by scrolling is pressed', async () => {
    scrollTo(phone, 100000)
    await press(phone.fabric, 'row-2003')
    expect(status(phone)).toContain('pressed:2003')
  })

  it('measures rows, and sizes the canvas and spacer from real heights', async () => {
    await layOutRows(phone)
    const ids = rowIds(phone)
    const measured = ids.reduce((sum, id) => sum + realHeight(id), 0)
    expect(canvasOf(phone).props['height']).toBe(measured + (COUNT - ids.length) * ESTIMATE)
    // Scroll down a little: rows already measured above the window keep their real height.
    scrollTo(phone, 900)
    await layOutRows(phone)
    const first = rowIds(phone)[0] ?? 0
    const above = Array.from({ length: first }, (_unused, id) => realHeight(id))
    expect(canvasOf(phone).children[0]?.props['height']).toBe(
      above.reduce((sum, height) => sum + height, 0),
    )
  })

  it('keeps the row on screen in place when rows above it turn out taller', async () => {
    // Jump into the middle, where nothing has been measured.
    scrollTo(phone, 100025)
    expect(phone.fabric.commands.filter(command => command.name === 'scrollTo')).toEqual([])
    await layOutRows(phone)
    // Row 2000 was at the top, 25 points scrolled past. The rows drawn above
    // it are now their real heights, so the same row is further down.
    const first = rowIds(phone)[0] ?? 0
    const above = Array.from({ length: 2000 - first }, (_unused, at) => realHeight(first + at))
    const wanted = first * ESTIMATE + above.reduce((sum, height) => sum + height, 0) + 25
    const scrolls = phone.fabric.commands.filter(command => command.name === 'scrollTo')
    expect(scrolls.at(-1)?.args).toEqual([0, wanted, false])
  })

  it('updates the rows when the Model adds, removes and reorders items', async () => {
    await press(phone.fabric, 'prepend')
    expect(rowIds(phone).slice(0, 3)).toEqual([100000, 0, 1])
    await press(phone.fabric, 'remove-first')
    expect(rowIds(phone).slice(0, 3)).toEqual([0, 1, 2])
    await press(phone.fabric, 'reverse')
    expect(rowIds(phone).slice(0, 3)).toEqual([4999, 4998, 4997])
    expect(hasTestId(phone.fabric, 'row-0')).toBe(false)
  })

  it('redraws a row whose item changed', async () => {
    expect(textOf(byTestId(phone.fabric, 'row-0'))).toBe('Row 0')
    await press(phone.fabric, 'rename')
    expect(textOf(byTestId(phone.fabric, 'row-0'))).toBe('Renamed')
  })

  it('keeps what is on screen in place when a row is added above it', async () => {
    scrollTo(phone, 100025)
    await press(phone.fabric, 'prepend')
    const scrolls = phone.fabric.commands.filter(command => command.name === 'scrollTo')
    expect(scrolls.at(-1)?.args).toEqual([0, 100025 + ESTIMATE, false])
    expect(rowIds(phone)).toContain(2000)
  })

  it('sends one Message when the end comes near, however many scroll events', async () => {
    const end = COUNT * ESTIMATE - VIEWPORT
    scrollTo(phone, end - 100)
    scrollTo(phone, end - 50)
    scrollTo(phone, end)
    await settle()
    expect(status(phone)).toContain('ends:1')
    // Away from the end and back again counts once more.
    scrollTo(phone, 1000)
    scrollTo(phone, end)
    await settle()
    expect(status(phone)).toContain('ends:2')
  })

  it('scrolls to row 2,500 from a Command and draws the rows there first', async () => {
    await press(phone.fabric, 'jump')
    expect(rowIds(phone)).toContain(2500)
    const scrolls = phone.fabric.commands.filter(command => command.name === 'scrollTo')
    expect(scrolls.at(-1)?.args).toEqual([0, 2500 * ESTIMATE, false])
  })

  it('takes its rows away with it', async () => {
    await press(phone.fabric, 'hide')
    expect(hasTestId(phone.fabric, 'list')).toBe(false)
    expect(hasTestId(phone.fabric, 'row-0')).toBe(false)
    expect(textOf(byTestId(phone.fabric, 'row-count'))).toBe('0 row views (rows 1 to 0 of 0)')
  })

  it('puts the refresh control where the platform wants it', () => {
    const scroll = byTestId(phone.fabric, 'plain-scroll')
    const list_ = byTestId(phone.fabric, 'list')
    if (platform === 'ios') {
      expect(scroll.children.map(child => child.viewName)).toEqual(['PullToRefreshView', 'View'])
      expect(list_.children[0]?.viewName).toBe('PullToRefreshView')
      expect(scroll.props['flex']).toBe(1)
    } else {
      const wrapper = flatten(phone.fabric.committed).find(
        node => node.viewName === 'AndroidSwipeRefreshLayout' && node.children[0] === scroll,
      )
      // The wrapper takes the styles that size the scroll view. The paint stays.
      expect(wrapper?.props['flex']).toBe(1)
      expect(scroll.props['flex']).toBeUndefined()
      expect(scroll.props['backgroundColor']).toBe('#fff')
      expect(scroll.props['nestedScrollEnabled']).toBe(true)
    }
  })

  it('round-trips pull to refresh: a pull sends a Message, the Model stops the spinner', async () => {
    const control = (): FakeFabricNode => {
      const found = flatten(phone.fabric.committed).filter(node =>
        ['PullToRefreshView', 'AndroidSwipeRefreshLayout'].includes(node.viewName),
      )
      // The list's control comes first in the tree.
      if (found[0] === undefined) throw new Error('No refresh control')
      return found[0]
    }
    expect(control().props['refreshing']).toBe(false)
    phone.fabric.emit(control(), 'topRefresh', {})
    await settle()
    expect(status(phone)).toContain('pulls:1')
    expect(control().props['refreshing']).toBe(true)
    expect(phone.fabric.commands.filter(c => c.name === 'setNativeRefreshing')).toEqual([])
    await press(phone.fabric, 'finish-refresh')
    expect(control().props['refreshing']).toBe(false)
    expect(
      phone.fabric.commands.filter(c => c.name === 'setNativeRefreshing').map(c => c.args),
    ).toEqual([[false]])
  })
})
