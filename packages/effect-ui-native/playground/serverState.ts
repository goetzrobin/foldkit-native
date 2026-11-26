/**
 * Server state: a list that lives on a server, shown through Effect UI's
 * `Query`.
 *
 * The server here is a pretend one inside the app. It keeps a short list and
 * answers after a delay, as a real one would.
 *
 * - The list is a query. The screen shows what the cache holds.
 * - Add saves a row, then the list loads again.
 * - Delete hides the row at once, before the server has answered. When the
 *   server says yes, the row stays gone. When it says no, the row comes back.
 * - "Next save fails" makes the server refuse the next Add or Delete.
 * - The line at the top counts how often the list was loaded. Leave the app
 *   and come back, and it goes up by one.
 */
import { Command, Query, UiSchema } from '@effect/ui'
import { Context, Effect, Layer, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'

import { Native } from '../src/index.js'
import * as Look from './look.js'

// THE PRETEND SERVER

const Item = Schema.Struct({ id: Schema.String, text: Schema.String })
type Item = typeof Item.Type

/** What the list request answers: the rows, and how many times the list was asked for. */
const Listing = Schema.Struct({ items: Schema.Array(Item), fetches: Schema.Number })

export class SaveFailed extends Schema.TaggedError<SaveFailed>()('SaveFailed', { reason: Schema.String }) {}

export class FakeServer extends Context.Service<
  FakeServer,
  {
    readonly list: Effect.Effect<typeof Listing.Type>
    readonly add: (text: string, shouldFail: boolean) => Effect.Effect<void, SaveFailed>
    readonly remove: (id: string, shouldFail: boolean) => Effect.Effect<void, SaveFailed>
    /** For tests and readouts: what the server holds now, with no delay. */
    readonly peek: () => Readonly<{ items: ReadonlyArray<Item>; fetches: number }>
  }
>()('playground/FakeServer') {}

const SEED: ReadonlyArray<Item> = [
  { id: 'i1', text: 'Bread' },
  { id: 'i2', text: 'Apples' },
  { id: 'i3', text: 'Coffee' },
]

/** A server in memory that answers after `delayMs`. */
export const fakeServer = (options: Readonly<{ delayMs?: number }> = {}): Layer.Layer<FakeServer> =>
  Layer.sync(FakeServer, () => {
    const delay = Effect.sleep(`${options.delayMs ?? 600} millis`)
    let items = [...SEED]
    let fetches = 0
    let nextId = SEED.length + 1
    const refuse = Effect.fail(new SaveFailed({ reason: 'The server said no.' }))
    return {
      list: Effect.andThen(
        delay,
        Effect.sync(() => ({ items, fetches: ++fetches })),
      ),
      add: (text, shouldFail) =>
        Effect.andThen(
          delay,
          shouldFail
            ? refuse
            : Effect.sync(() => {
                items = [...items, { id: `i${nextId++}`, text }]
              }),
        ),
      remove: (id, shouldFail) =>
        Effect.andThen(
          delay,
          shouldFail
            ? refuse
            : Effect.sync(() => {
                items = items.filter(item => item.id !== id)
              }),
        ),
      peek: () => ({ items, fetches }),
    }
  })

// THE QUERY AND THE WRITES

/**
 * The list. `staleTime` is zero: what the cache holds is always taken to be
 * old, so the list loads again each time the screen opens and each time the
 * app comes back to the front.
 */
export class ListItems extends Query.Service<ListItems>()('playground/ListItems', {
  args: {},
  success: Listing,
  error: Schema.Never,
  staleTime: 0,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const server = yield* FakeServer
      return () => server.list
    }),
  )
}

/** Saves a row. When it ends, the list loads again. */
export class AddItem extends Command.Service<AddItem>()('playground/AddItem', {
  args: { text: Schema.String, shouldFail: Schema.Boolean },
  success: Schema.Void,
  error: SaveFailed,
  invalidates: () => [ListItems],
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const server = yield* FakeServer
      return ({ text, shouldFail }) => server.add(text, shouldFail)
    }),
  )
}

/**
 * Deletes a row. The row is hidden from the moment the Command is issued.
 * If the server refuses, the hiding is dropped and the row is back.
 */
export class DeleteItem extends Command.Service<DeleteItem>()('playground/DeleteItem', {
  args: { id: Schema.String, shouldFail: Schema.Boolean },
  success: Schema.Void,
  error: SaveFailed,
  optimistic: ({ id }) => [
    ListItems.patch({}, listing => ({ ...listing, items: listing.items.filter(item => item.id !== id) })),
  ],
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const server = yield* FakeServer
      return ({ id, shouldFail }) => server.remove(id, shouldFail)
    }),
  )
}

/** The query and the two writes, over the server. */
export const layer: Layer.Layer<ListItems | AddItem | DeleteItem, never, FakeServer> = Layer.mergeAll(
  ListItems.layer,
  AddItem.layer,
  DeleteItem.layer,
)

// THE SCREEN

export const ServerStateMessage = UiSchema.TaggedEnum({
  PressedAdd: {},
  PressedDelete: { id: Schema.String },
  PressedFailNext: {},
  Saved: {},
  FailedSave: { reason: Schema.String },
})

const ServerStateModel = Schema.Struct({
  /** The next Add or Delete is refused by the server. */
  failNext: Schema.Boolean,
  added: Schema.Number,
  notice: Schema.String,
})

const EXTRA = ['Milk', 'Rice', 'Tea', 'Eggs', 'Salt']

const answered = Command.match({
  onSuccess: () => ServerStateMessage.Saved(),
  onFailure: (error: SaveFailed) => ServerStateMessage.FailedSave({ reason: error.reason }),
})

export const ServerState = Native.component({
  name: 'ServerState',
  model: ServerStateModel,
  message: ServerStateMessage,
  queries: { list: { query: ListItems, args: () => ({}) } },
}).make({
  init: () => ({ failNext: false, added: 0, notice: '' }),
  update: {
    PressedAdd: $ =>
      $.evolve({ failNext: false, added: n => n + 1, notice: '' }).run(
        AddItem.make({
          text: EXTRA[$.model.added % EXTRA.length] ?? 'Milk',
          shouldFail: $.model.failNext,
        }).pipe(answered),
      ),
    PressedDelete: ($, { id }) =>
      $.evolve({ failNext: false, notice: '' }).run(
        DeleteItem.make({ id, shouldFail: $.model.failNext }).pipe(answered),
      ),
    PressedFailNext: $ => $.evolve({ failNext: on => !on }),
    Saved: $ => $.evolve({ notice: 'Saved.' }),
    FailedSave: ($, { reason }) => $.evolve({ notice: `Not saved: ${reason}` }),
  },
  view: (h, model) => {
    const list = h.queries.list
    const state = AsyncResult.match(list, {
      onInitial: () => 'loading',
      onSuccess: success => (success.waiting ? 'loading again' : 'loaded'),
      onFailure: () => 'failed',
    })
    const fetches = AsyncResult.isSuccess(list) ? list.value.fetches : 0
    const items = AsyncResult.isSuccess(list) ? list.value.items : []
    return h.view.style(Look.page).children(
      h.view.style(Look.pad).children(
        h.text.testId('server-status').style(Look.small).children(`List loaded ${fetches} times. Now: ${state}.`),
        h.view.style({ flexDirection: 'row', gap: 8, alignItems: 'center' }).children(
          Look.plainButton(h, 'server-add', 'Add', ServerStateMessage.PressedAdd()),
          h.pressable
            .testId('server-fail-next')
            .style({
              paddingVertical: 12,
              paddingHorizontal: 16,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: model.failNext ? Look.RED : Look.LINE,
            })
            .pressedStyle(Look.buttonPressed)
            .on('press', ServerStateMessage.PressedFailNext())
            .children(
              h.text
                .style({ fontSize: 16, color: model.failNext ? Look.RED : Look.INK })
                .children(model.failNext ? 'Next save fails: on' : 'Next save fails: off'),
            ),
        ),
        h.text.testId('server-notice').style(Look.small).children(model.notice === '' ? ' ' : model.notice),
      ),
      h.scrollView.testId('server-list').style({ flex: 1 }).children(
        AsyncResult.isInitial(list)
          ? h.text.key('loading').testId('server-loading').style({ ...Look.small, padding: 16 }).children('Loading the list.')
          : items.length === 0
            ? h.text.key('empty').testId('server-empty').style({ ...Look.small, padding: 16 }).children('The list is empty.')
            : items.map(item =>
                h.view
                  .key(item.id)
                  .testId(`server-row-${item.id}`)
                  .style({ ...Look.row, flexDirection: 'row', alignItems: 'center', gap: 12 })
                  .children(
                    h.text.style({ ...Look.label, flex: 1 }).children(item.text),
                    h.pressable
                      .testId(`server-delete-${item.id}`)
                      .pressedStyle({ opacity: 0.5 })
                      .on('press', ServerStateMessage.PressedDelete({ id: item.id }))
                      .children(h.text.style({ fontSize: 15, color: Look.RED }).children('Delete')),
                  ),
              ),
      ),
    )
  },
})
