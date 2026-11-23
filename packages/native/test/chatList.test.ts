/**
 * The list options a chat needs, on the simulated phone: open at the end,
 * stay at the end, keep still when scrolled up, blank space for a streamed
 * reply, and one Message each time "at the end" flips.
 *
 * The simulated phone has no layout. Each test plays the phone's part: it
 * says how tall the list and each row are, and where the list has scrolled.
 * A row here draws its own height as its text, which is how the pretend
 * phone knows what to report.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, describe, expect, it } from 'vitest'

import { style, text, view as box } from '../src/index.js'
import {
  Heights,
  type ListConfig,
  endSpaceFor,
  isAtEnd,
  list,
  scrollListToEnd,
} from '../src/list/index.js'
import { type Phone, byTestId, flatten, press, settle, startPhone, textOf } from './support/phone.js'

const Item = Schema.Struct({ id: Schema.Number, height: Schema.Number })
type Item = typeof Item.Type

const Model = Schema.Struct({
  items: Schema.Array(Item),
  nextId: Schema.Number,
  /** Every at-end Message received, in order. */
  atEnd: Schema.Array(Schema.Boolean),
  /** The row `anchoredEndSpace` names, or -1 for none. */
  anchorIndex: Schema.Number,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedAppend: {},
  PressedPrepend: {},
  PressedGrowLast: {},
  PressedSend: {},
  PressedToEnd: {},
  CompletedToEnd: {},
  ChangedAtEnd: { isAtEnd: Schema.Boolean },
})
type Message = typeof Message.Type

const ToEnd = Command.define('ToEnd', {
  messages: [Message.CompletedToEnd],
  execute: scrollListToEnd('rows', { animated: true }).pipe(Effect.as(Message.CompletedToEnd())),
})

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedAppend: () => ({
      model: modifyFields(model, {
        items: items => [...items, { id: model.nextId, height: 80 }],
        nextId: nextId => nextId + 1,
      }),
    }),
    PressedPrepend: () => ({
      model: modifyFields(model, {
        items: items => [{ id: model.nextId, height: 80 }, ...items],
        nextId: nextId => nextId + 1,
      }),
    }),
    PressedGrowLast: () => ({
      model: modifyFields(model, {
        items: items =>
          items.map((item, at) =>
            at === items.length - 1 ? { ...item, height: item.height + 100 } : item,
          ),
      }),
    }),
    // As an AI chat does: the question, an empty answer, and the question anchored.
    PressedSend: () => ({
      model: modifyFields(model, {
        items: items => [
          ...items,
          { id: model.nextId, height: 60 },
          { id: model.nextId + 1, height: 40 },
        ],
        nextId: nextId => nextId + 2,
        anchorIndex: () => model.items.length,
      }),
    }),
    PressedToEnd: () => ({ model, commands: [ToEnd()] }),
    CompletedToEnd: () => ({ model }),
    ChangedAtEnd: ({ isAtEnd: answer }) => ({
      model: modifyFields(model, { atEnd: atEnd => [...atEnd, answer] }),
    }),
  })

const ESTIMATE = 50
const ROW = 70
const VIEWPORT = 600

const makeInit =
  (count: number): Runtime.ElementInit<Model, Message> =>
  () => ({
    model: {
      items: Array.from({ length: count }, (_unused, id) => ({ id, height: ROW })),
      nextId: 1000,
      atEnd: [],
      anchorIndex: -1,
    },
  })

type Options = Partial<
  Pick<
    ListConfig<Item, Message>,
    'alignItemsAtEnd' | 'initialScrollAtEnd' | 'maintainScrollAtEnd'
  >
>

const button = (h: HtmlBuilder<Message>, id: string, message: Message): Html =>
  box([h.Attribute('testID', id), h.OnClick(message)], [text([], [id])])

const makeView =
  (options: Options) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    box(
      [style({ flex: 1 })],
      [
        text([h.Attribute('testID', 'at-end')], [model.atEnd.join(',')]),
        button(h, 'append', Message.PressedAppend()),
        button(h, 'prepend', Message.PressedPrepend()),
        button(h, 'grow-last', Message.PressedGrowLast()),
        button(h, 'send', Message.PressedSend()),
        button(h, 'to-end', Message.PressedToEnd()),
        list(h, {
          id: 'rows',
          items: model.items,
          key: item => item.id,
          estimatedRowHeight: ESTIMATE,
          row: item =>
            box([h.Attribute('testID', `row-${item.id}`)], [text([], [String(item.height)])]),
          ...options,
          ...(model.anchorIndex < 0
            ? {}
            : {
                anchoredEndSpace: {
                  anchorIndex: model.anchorIndex,
                  anchorMaxSize: 100,
                  anchorOffset: 16,
                },
              }),
          onAtEndChanged: answer => Message.ChangedAtEnd({ isAtEnd: answer }),
          attributes: [h.Attribute('testID', 'list'), style({ flex: 1 })],
        }),
      ],
    )

let phone: Phone
let handle: { dispose: () => void } | undefined

const start = async (count: number, options: Options): Promise<void> => {
  phone = startPhone('ios')
  handle = Runtime.embed(
    Runtime.makeElement({
      Model,
      init: makeInit(count),
      update,
      view: makeView(options),
      container: phone.surface.container,
    }),
  )
  await settle()
}

afterEach(async () => {
  // The tests of plain arithmetic start no program.
  if (handle === undefined) return
  handle.dispose()
  handle = undefined
  await settle()
  phone.surface.dispose()
})

const contentOf = (): FakeFabricNode => {
  const content = byTestId(phone.fabric, 'list').children.at(-1)
  if (content === undefined) throw new Error('The list has no content view')
  return content
}

const canvasOf = (): FakeFabricNode => {
  const canvas = contentOf().children[0]
  if (canvas === undefined) throw new Error('The list has no canvas')
  return canvas
}

const rowIds = (): number[] =>
  flatten([canvasOf()])
    .map(node => node.props['testID'])
    .filter((id): id is string => typeof id === 'string' && id.startsWith('row-'))
    .map(id => Number(id.slice(4)))

/** The phone reports each row's height: the number the row draws. */
const layOutRows = async (): Promise<void> => {
  for (let round = 0; round < 4; round++) {
    for (const wrapper of canvasOf().children.slice(1)) {
      const height = Number(textOf(wrapper))
      phone.fabric.emit(wrapper, 'topLayout', { layout: { x: 0, y: 0, width: 320, height } })
    }
    await settle()
  }
}

const layOutList = async (height = VIEWPORT): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'list'), 'topLayout', {
    layout: { x: 0, y: 0, width: 320, height },
  })
  await settle()
}

/** The phone has scrolled, by a finger or because it was told to. */
const scrollTo = (y: number, viewport = VIEWPORT): void => {
  phone.fabric.emit(byTestId(phone.fabric, 'list'), 'topScroll', {
    contentOffset: { x: 0, y },
    layoutMeasurement: { width: 320, height: viewport },
    contentSize: { width: 320, height: Number(canvasOf().props['height']) },
  })
}

const scrolls = (): ReadonlyArray<ReadonlyArray<unknown>> =>
  phone.fabric.commands.filter(command => command.name === 'scrollTo').map(command => command.args)

const lastScroll = (): ReadonlyArray<unknown> | undefined => scrolls().at(-1)

/** Does what the phone does after being told to scroll: goes there and says so. */
const obeyLastScroll = async (): Promise<void> => {
  const target = lastScroll()?.[1]
  if (typeof target === 'number') scrollTo(target)
  await settle()
}

const atEndLog = (): string => textOf(byTestId(phone.fabric, 'at-end'))

/** Opens a list of 40 rows of 70 points and lets the phone lay it out. */
const open = async (options: Options, count = 40): Promise<void> => {
  await start(count, options)
  await layOutList()
  await layOutRows()
  await obeyLastScroll()
}

describe('the arithmetic of a list that lives at its end', () => {
  it('sizes the blank space so the anchored row can reach the top', () => {
    const heights = new Heights([70, 70, 70, 60, 40])
    // The screen, less the gap, less the anchored row and the row after it.
    expect(endSpaceFor(heights, 600, { anchorIndex: 3, anchorOffset: 16 })).toBe(484)
    // Only the last 50 points of the anchored row are kept on screen.
    expect(endSpaceFor(heights, 600, { anchorIndex: 3, anchorMaxSize: 50 })).toBe(510)
    // No space once the rows after the anchor fill the screen.
    expect(endSpaceFor(new Heights([60, 900]), 600, { anchorIndex: 0 })).toBe(0)
    expect(endSpaceFor(heights, 600, undefined)).toBe(0)
    expect(endSpaceFor(heights, 600, { anchorIndex: 9 })).toBe(0)
    // Not before the phone has said how tall the list is.
    expect(endSpaceFor(heights, 0, { anchorIndex: 3 })).toBe(0)
  })

  it('says whether the end is on screen', () => {
    expect(isAtEnd(1000, 400, 600, 0)).toBe(true)
    expect(isAtEnd(1000, 350, 600, 60)).toBe(true)
    expect(isAtEnd(1000, 300, 600, 60)).toBe(false)
    // Content shorter than the screen is all on screen.
    expect(isAtEnd(200, 0, 600, 0)).toBe(true)
  })
})

describe('a list that opens at its end', () => {
  it('draws the last rows first, unseen, and is shown once it is at the end', async () => {
    await start(40, { initialScrollAtEnd: true })
    expect(rowIds()).toContain(39)
    expect(rowIds()).not.toContain(0)
    expect(canvasOf().props['opacity']).toBe(0)
    expect(scrolls()).toEqual([])

    await layOutList()
    // Still unseen: the rows at the end have not been measured.
    expect(canvasOf().props['opacity']).toBe(0)
    await layOutRows()

    expect(canvasOf().props['opacity']).toBe(1)
    const total = Number(canvasOf().props['height'])
    expect(lastScroll()).toEqual([0, total - VIEWPORT, false])
    // The end of a list of measured 70 point rows shows whole rows.
    const measured = rowIds().length
    expect(total).toBe(measured * ROW + (40 - measured) * ESTIMATE)
  })

  it('does not send an at-end Message for opening at the end', async () => {
    await open({ initialScrollAtEnd: true })
    expect(atEndLog()).toBe('')
  })

  it('is shown anyway if the phone never reports the layout', async () => {
    await start(40, { initialScrollAtEnd: true })
    expect(canvasOf().props['opacity']).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 450))
    expect(canvasOf().props['opacity']).toBe(1)
  })

  it('is shown at once when the user takes hold of it', async () => {
    await start(40, { initialScrollAtEnd: true })
    phone.fabric.emit(byTestId(phone.fabric, 'list'), 'topScrollBeginDrag', {})
    expect(canvasOf().props['opacity']).toBe(1)
  })

  it('pushes a few rows to the bottom with alignItemsAtEnd', async () => {
    await start(2, { alignItemsAtEnd: true, initialScrollAtEnd: true })
    expect(contentOf().props['flexGrow']).toBe(1)
    expect(contentOf().props['justifyContent']).toBe('flex-end')
    await layOutList()
    await layOutRows()
    // Shorter than the screen: nothing to scroll, and it is shown.
    expect(scrolls()).toEqual([])
    expect(canvasOf().props['opacity']).toBe(1)
    expect(canvasOf().props['height']).toBe(2 * ROW)
  })

  it('leaves the content view alone without alignItemsAtEnd', async () => {
    await start(2, {})
    expect(contentOf().props['flexGrow']).toBeUndefined()
    expect(canvasOf().props['opacity']).toBeUndefined()
  })
})

describe('a list that stays at its end', () => {
  const chat: Options = { initialScrollAtEnd: true, maintainScrollAtEnd: true }

  it('follows a row that is added', async () => {
    await open(chat)
    const before = scrolls().length
    await press(phone.fabric, 'append')
    await layOutRows()
    expect(rowIds()).toContain(1000)
    expect(scrolls().length).toBeGreaterThan(before)
    const total = Number(canvasOf().props['height'])
    expect(lastScroll()).toEqual([0, total - VIEWPORT, false])
    expect(atEndLog()).toBe('')
  })

  it('follows a row that grows, as streamed text does', async () => {
    await open(chat)
    const end = Number(lastScroll()?.[1])
    await press(phone.fabric, 'grow-last')
    await layOutRows()
    expect(lastScroll()).toEqual([0, end + 100, false])
    await obeyLastScroll()
    await press(phone.fabric, 'grow-last')
    await layOutRows()
    expect(lastScroll()).toEqual([0, end + 200, false])
    expect(atEndLog()).toBe('')
  })

  it('follows when the list gets shorter, as it does when the keyboard opens', async () => {
    await open(chat)
    const end = Number(lastScroll()?.[1])
    await layOutList(VIEWPORT - 300)
    expect(lastScroll()).toEqual([0, end + 300, false])
    scrollTo(end + 300, VIEWPORT - 300)
    // And back when the keyboard closes.
    await layOutList(VIEWPORT)
    expect(lastScroll()).toEqual([0, end, false])
    expect(atEndLog()).toBe('')
  })

  it('leaves a user who has scrolled up where they are when a row is added', async () => {
    await open(chat)
    scrollTo(700)
    await settle()
    const before = scrolls().length
    const rowsBefore = rowIds()
    await press(phone.fabric, 'append')
    await layOutRows()
    expect(scrolls().length).toBe(before)
    expect(rowIds().slice(0, 5)).toEqual(rowsBefore.slice(0, 5))
  })

  it('leaves a user who has scrolled up where they are when the last row grows', async () => {
    await open(chat)
    scrollTo(700)
    await settle()
    const before = scrolls().length
    await press(phone.fabric, 'grow-last')
    await layOutRows()
    expect(scrolls().length).toBe(before)
  })

  it('keeps what a scrolled-up user reads in place when a row is added above it', async () => {
    await open(chat)
    scrollTo(700)
    await settle()
    await press(phone.fabric, 'prepend')
    // The new row is above the screen and not drawn, so it counts as its
    // estimated height until it is seen.
    expect(lastScroll()).toEqual([0, 700 + ESTIMATE, false])
  })

  it('does not follow without maintainScrollAtEnd', async () => {
    await open({ initialScrollAtEnd: true })
    const before = scrolls().length
    await press(phone.fabric, 'append')
    await layOutRows()
    expect(scrolls().length).toBe(before)
    // The end has moved away from the user by a row: that is a flip.
    expect(atEndLog()).toBe('false')
  })
})

describe('the at-end Message', () => {
  const chat: Options = { initialScrollAtEnd: true, maintainScrollAtEnd: true }

  it('is sent once when the user leaves the end and once when they return', async () => {
    await open(chat)
    const end = Number(lastScroll()?.[1])
    // Within a tenth of the screen of the end still counts as the end.
    scrollTo(end - 30)
    await settle()
    expect(atEndLog()).toBe('')
    for (const y of [end - 100, end - 200, end - 400, end - 800, end - 900]) scrollTo(y)
    await settle()
    expect(atEndLog()).toBe('false')
    for (const y of [end - 600, end - 300, end - 100, end - 20, end]) scrollTo(y)
    await settle()
    expect(atEndLog()).toBe('false,true')
  })

  it('takes a list that does not open at its end to be away from it', async () => {
    await start(40, {})
    await layOutList()
    await layOutRows()
    scrollTo(100)
    scrollTo(200)
    await settle()
    // The Model starts with "not at the end", so there is nothing to say.
    expect(atEndLog()).toBe('')
    scrollTo(Number(canvasOf().props['height']) - VIEWPORT)
    await settle()
    expect(atEndLog()).toBe('true')
  })

  it('says so when a list that opens at the top is short enough to be all on screen', async () => {
    await start(3, {})
    await layOutList()
    await settle()
    expect(atEndLog()).toBe('true')
  })

  it('is sent once for a glide to the end, not for each position on the way', async () => {
    await open(chat)
    const end = Number(lastScroll()?.[1])
    scrollTo(200)
    await settle()
    expect(atEndLog()).toBe('false')

    await press(phone.fabric, 'to-end')
    expect(lastScroll()).toEqual([0, end, true])
    expect(atEndLog()).toBe('false,true')
    // The phone reports where the glide has got to.
    for (const y of [400, 900, 1500, end - 50]) scrollTo(y)
    await settle()
    expect(atEndLog()).toBe('false,true')
    scrollTo(end)
    await settle()
    expect(atEndLog()).toBe('false,true')
    // Arrived: from here a scroll away counts again.
    scrollTo(end - 500)
    await settle()
    expect(atEndLog()).toBe('false,true,false')
  })

  it('lets the user stop a glide: the list is then where they left it', async () => {
    await open(chat)
    scrollTo(200)
    await press(phone.fabric, 'to-end')
    scrollTo(900)
    phone.fabric.emit(byTestId(phone.fabric, 'list'), 'topScrollBeginDrag', {})
    scrollTo(880)
    await settle()
    expect(atEndLog()).toBe('false,true,false')
    // The rows here are seen for the first time and measured. Rows above
    // the screen turn out taller, and the list keeps the user's place.
    await layOutRows()
    await obeyLastScroll()
    // And a new row does not drag them to the end.
    const before = scrolls().length
    await press(phone.fabric, 'append')
    await layOutRows()
    expect(scrolls().length).toBe(before)
  })
})

describe('scrolling to the end from a Command', () => {
  it('draws the rows at the end first, and settles there as they are measured', async () => {
    // Opens at the top: nothing at the end has been measured.
    await start(40, {})
    await layOutList()
    await layOutRows()
    expect(rowIds()).not.toContain(39)

    await press(phone.fabric, 'to-end')
    expect(rowIds()).toContain(39)
    const guessed = Number(lastScroll()?.[1])
    expect(lastScroll()?.[2]).toBe(true)

    // The rows there turn out taller than the estimate. The list keeps to
    // the real end, still gliding.
    await layOutRows()
    const total = Number(canvasOf().props['height'])
    expect(total - VIEWPORT).toBeGreaterThan(guessed)
    expect(lastScroll()).toEqual([0, total - VIEWPORT, true])
  })
})

describe('blank space for a streamed reply', () => {
  const aiChat: Options = { initialScrollAtEnd: true }

  /** Where row `index` starts, with every row at its real height. */
  const realOffsetOf = (index: number): number => index * ROW

  it('scrolls a sent message to the top, with room below it for the reply', async () => {
    await open(aiChat)
    await press(phone.fabric, 'send')
    await layOutRows()

    // The question (60) is row 40, the empty answer (40) row 41.
    expect(rowIds()).toContain(1000)
    expect(rowIds()).toContain(1001)
    // Every row from the old end to the new one has been drawn and measured
    // by now, but rows further up are still estimates. So read the sums
    // from the list: the canvas, less the rows, is the blank space.
    const canvas = Number(canvasOf().props['height'])
    const space = VIEWPORT - 16 - 60 - 40
    // The end of the list is now the place where the question is 16 points
    // below the top of the screen.
    const end = Number(lastScroll()?.[1])
    expect(end).toBe(canvas - VIEWPORT)
    expect(lastScroll()?.[2]).toBe(true)
    // rows + space - viewport = start of the question - 16
    const rows = canvas - space
    expect(end).toBe(rows - 60 - 40 - 16)
    expect(atEndLog()).toBe('')
  })

  it('does not move the list while the reply grows into the space', async () => {
    await open(aiChat)
    await press(phone.fabric, 'send')
    await layOutRows()
    await obeyLastScroll()
    const canvas = canvasOf().props['height']
    const before = scrolls().length

    // 40 -> 140 -> 240 -> 340: still inside the 484 points of space.
    for (let step = 0; step < 3; step++) {
      await press(phone.fabric, 'grow-last')
      await layOutRows()
      expect(canvasOf().props['height']).toBe(canvas)
    }
    expect(scrolls().length).toBe(before)
    expect(atEndLog()).toBe('')
  })

  it('lets a reply longer than the space run off the screen, and says so once', async () => {
    await open(aiChat)
    await press(phone.fabric, 'send')
    await layOutRows()
    await obeyLastScroll()
    const canvas = Number(canvasOf().props['height'])
    const before = scrolls().length

    // 40 -> 840: 800 more, of which the space takes 484.
    for (let step = 0; step < 8; step++) {
      await press(phone.fabric, 'grow-last')
      await layOutRows()
    }
    expect(canvasOf().props['height']).toBe(canvas + 800 - (VIEWPORT - 16 - 60 - 40))
    // The question stays where it is: the list was not scrolled.
    expect(scrolls().length).toBe(before)
    expect(atEndLog()).toBe('false')
  }, 20000)

  it('travels to the new message from far up the list', async () => {
    await open(aiChat)
    scrollTo(realOffsetOf(3))
    await settle()
    expect(atEndLog()).toBe('false')
    expect(rowIds()).not.toContain(39)

    await press(phone.fabric, 'send')
    expect(rowIds()).toContain(1000)
    expect(lastScroll()?.[2]).toBe(true)
    await layOutRows()
    const canvas = Number(canvasOf().props['height'])
    expect(lastScroll()).toEqual([0, canvas - VIEWPORT, true])
    expect(atEndLog()).toBe('false,true')
  })

  it('shows only the end of a very tall anchored row', () => {
    const heights = new Heights([70, 400, 40])
    const space = endSpaceFor(heights, 600, { anchorIndex: 1, anchorMaxSize: 100, anchorOffset: 16 })
    // The end of the list: the last 100 points of the row, 16 below the top.
    const end = heights.total() + space - 600
    expect(end).toBe(70 + 300 - 16)
  })
})
