/**
 * The phone's own list of choices, as a Command: the action sheet on an
 * iPhone, a list dialog on Android.
 *
 *   HeldRow: $ => $.run(
 *     Menus.Show.make({ title: '', items: [{ key: 'copy', title: 'Copy', isDestructive: false }] })
 *       .pipe(Command.map(answer => Message.ChoseFromMenu({ answer }))),
 *   )
 *
 * The Command ends when the person has chosen or closed the list. The answer
 * is `Selected` with the item's key, `Dismissed`, or `Failed` with the
 * reason (a build without React Native's module for it).
 *
 * The native half is the host layer's (`packages/native/src/host/menus/sheet.ts`,
 * unchanged). `Menus.live` is the real one. `Menus.makeTest()` is a fake a
 * test answers by hand.
 *
 * Also here: what a title bar button's menu is made of (`MenuItem`), which
 * `NativeViews.barButtons` takes.
 */
import * as Command from '@effect/ui/Command'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { type MenuItem, flatten } from '../../native/src/host/menus/items.js'
import { type SheetAnswer, type SheetRequest, presentSheet } from '../../native/src/host/menus/sheet.js'

export { configureSheets as configure, sheetRouteName as routeName } from '../../native/src/host/menus/sheet.js'
export { flatten }
export type { MenuItem }

/** One line of the list. */
export const Item = Schema.Struct({
  /** Comes back when the person chooses this line. */
  key: Schema.String,
  title: Schema.String,
  /** Red: for deleting and the like. */
  isDestructive: Schema.Boolean,
})
export type Item = typeof Item.Type

/** How the list ended. */
export const Answer = Schema.Union([
  Schema.TaggedStruct('Selected', { key: Schema.String }),
  Schema.TaggedStruct('Dismissed', {}),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type Answer = typeof Answer.Type

/** Shows a list of choices and answers once. Fails with the reason when this phone has no such list. */
export class ActionSheet extends Context.Service<
  ActionSheet,
  { readonly show: (request: SheetRequest) => Effect.Effect<SheetAnswer, string> }
>()('effect-ui-native/Menus/ActionSheet') {}

/** The phone's own, through React Native's native modules. */
export const live: Layer.Layer<ActionSheet> = Layer.succeed(ActionSheet, {
  show: request =>
    Effect.callback<SheetAnswer, string>(resume => {
      try {
        presentSheet(request, answer => resume(Effect.succeed(answer)))
      } catch (error) {
        resume(Effect.fail(error instanceof Error ? error.message : String(error)))
      }
    }),
})

/**
 * A fake. `open()` is the list on screen now, if any. `choose(key)` and
 * `dismiss()` answer it, as a finger would. `shown` holds every list that
 * was opened.
 */
export const makeTest = () => {
  const shown: Array<SheetRequest> = []
  let waiting: { request: SheetRequest; answer: (answer: SheetAnswer) => void } | undefined
  let failure: string | undefined
  const layer = Layer.succeed(ActionSheet, {
    show: request =>
      Effect.callback<SheetAnswer, string>(resume => {
        if (failure !== undefined) {
          const reason = failure
          failure = undefined
          resume(Effect.fail(reason))
          return
        }
        shown.push(request)
        waiting = { request, answer: answer => resume(Effect.succeed(answer)) }
      }),
  })
  const answer = (next: SheetAnswer): void => {
    const open = waiting
    if (open === undefined) throw new Error('No list of choices is open')
    waiting = undefined
    open.answer(next)
  }
  return {
    layer,
    shown,
    open: (): SheetRequest | undefined => waiting?.request,
    /** The titles of the list on screen now. */
    titles: (): ReadonlyArray<string> => waiting?.request.options.map(option => option.title) ?? [],
    choose: (key: string) => answer({ _tag: 'Selected', key }),
    dismiss: () => answer({ _tag: 'Dismissed' }),
    failNext: (reason: string) => {
      failure = reason
    },
  }
}

/** Shows the list and answers with the choice. See the top of this file. */
export class Show extends Command.Service<Show>()('Menus/Show', {
  args: { title: Schema.String, items: Schema.Array(Item) },
  success: Answer,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const sheet = yield* ActionSheet
      return ({ title, items }) =>
        Effect.match(sheet.show({ ...(title === '' ? {} : { title }), options: items }), {
          onSuccess: (answer): Answer => answer,
          onFailure: (reason): Answer => ({ _tag: 'Failed', reason }),
        })
    }),
  )
}

/** The Command service, over an `ActionSheet`. */
export const layer: Layer.Layer<Show, never, ActionSheet> = Show.layer

/** A menu's entries as the lines of a list, for a phone that shows a menu as a list. */
export const itemsOf = (menu: ReadonlyArray<MenuItem>): ReadonlyArray<Item> =>
  flatten(menu).map(action => ({ key: action.key, title: action.title, isDestructive: action.isDestructive }))
