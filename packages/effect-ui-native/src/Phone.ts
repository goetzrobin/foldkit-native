/**
 * The phone's services as Effect UI Commands and Subscriptions: haptics, the
 * clipboard, the keyboard, whether the app is in front, light or dark.
 *
 *   // update
 *   PressedSave: $ => $.run(Phone.Impact.make({ style: 'light' }))
 *   PressedCopy: $ => $.run(Phone.Copy.make({ text: $.model.draft }).pipe(Command.map(...)))
 *
 *   // subscriptions
 *   subscriptions: () => [
 *     Phone.keyboard(frame => Message.ChangedKeyboard({ height: frame.height })),
 *     Phone.colorScheme(scheme => Message.ChangedScheme({ scheme })),
 *   ]
 *
 * The services themselves are the host layer's (`packages/native/src/host/device`):
 * `Phone.Device.live(modules)` over the real native modules, `Phone.Device.makeTest()`
 * as fakes a test can read and drive. `Phone.layer` turns them into the
 * Command services a component asks for.
 */
import * as Command from '@effect/ui/Command'
import * as Component from '@effect/ui/Component'
import * as Subscription from '@effect/ui/Subscription'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import * as Device from '../../native/src/host/device/index.js'

export { Device }

const { AppState, Clipboard, ColorScheme, Haptics, Keyboard } = Device

/** What a Command that can fail answers: it worked, or why not. */
export const Outcome = Schema.Union([
  Schema.TaggedStruct('Done', {}),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type Outcome = typeof Outcome.Type

const done: Outcome = { _tag: 'Done' }
const failed = (error: Device.DeviceError): Outcome => ({ _tag: 'Failed', reason: error.reason })

/** A tap under the finger. The phone decides whether anything is felt. */
export class Impact extends Command.Service<Impact>()('Phone/Impact', {
  args: { style: Haptics.ImpactStyle },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics.Haptics
      return ({ style }) => Effect.as(Effect.ignore(haptics.impact(style)), Component.noop)
    }),
  )
}

/** The small tick of a picker moving. */
export class Selection extends Command.Service<Selection>()('Phone/Selection', {
  args: {},
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics.Haptics
      return () => Effect.as(Effect.ignore(haptics.selection), Component.noop)
    }),
  )
}

/** The pattern the phone plays for an outcome. */
export class Notify extends Command.Service<Notify>()('Phone/Notify', {
  args: { type: Haptics.NotificationType },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics.Haptics
      return ({ type }) => Effect.as(Effect.ignore(haptics.notification(type)), Component.noop)
    }),
  )
}

/** Copies text to the clipboard. */
export class Copy extends Command.Service<Copy>()('Phone/Copy', {
  args: { text: Schema.String },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard.Clipboard
      return ({ text }) => Effect.match(clipboard.copy(text), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** What a read of the clipboard answers. */
export const Pasted = Schema.Union([
  Schema.TaggedStruct('Text', { text: Schema.String }),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type Pasted = typeof Pasted.Type

/** Reads the clipboard. Read when the user asks to paste, never on a timer. */
export class Paste extends Command.Service<Paste>()('Phone/Paste', {
  args: {},
  success: Pasted,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard.Clipboard
      return () =>
        Effect.match(clipboard.read, {
          onSuccess: (text): Pasted => ({ _tag: 'Text', text }),
          onFailure: (error): Pasted => ({ _tag: 'Failed', reason: error.reason }),
        })
    }),
  )
}

/** Puts the keyboard away. */
export class DismissKeyboard extends Command.Service<DismissKeyboard>()('Phone/DismissKeyboard', {
  args: {},
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard
      return () => Effect.as(keyboard.dismiss, Component.noop)
    }),
  )
}

/** Every Command service here. */
export type Commands = Impact | Selection | Notify | Copy | Paste | DismissKeyboard

/** What the Subscriptions here read. */
export type Sources = Device.Keyboard.Keyboard | Device.AppState.AppState | Device.ColorScheme.ColorScheme

/**
 * The Command services, over the phone's services. Give it the host's
 * `Device.live(modules)` or a test's `Device.makeTest().layer`:
 *
 *   Layer.provideMerge(Phone.layer, Phone.Device.live(modules))
 */
export const layer: Layer.Layer<
  Commands,
  never,
  Device.Haptics.Haptics | Device.Clipboard.Clipboard | Device.Keyboard.Keyboard
> = Layer.mergeAll(Impact.layer, Selection.layer, Notify.layer, Copy.layer, Paste.layer, DismissKeyboard.layer)

/** The keyboard as it is now, then every change. Height 0 is hidden. */
export const keyboard = <Msg>(
  toMessage: (frame: Device.Keyboard.KeyboardFrame) => Msg,
): Subscription.Subscription<Msg, Device.Keyboard.Keyboard> =>
  Subscription.make(
    'Phone/keyboard',
    Stream.unwrap(
      Keyboard.Keyboard.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('keyboard', service.frames), toMessage)),
      ),
    ),
  )

/** Whether the app is in front, then every change. */
export const appState = <Msg>(
  toMessage: (status: Device.AppState.AppStatus) => Msg,
): Subscription.Subscription<Msg, Device.AppState.AppState> =>
  Subscription.make(
    'Phone/appState',
    Stream.unwrap(
      AppState.AppState.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('appState', service.statuses), toMessage)),
      ),
    ),
  )

/** Light or dark as the phone is set, then every change. */
export const colorScheme = <Msg>(
  toMessage: (scheme: Device.ColorScheme.Scheme) => Msg,
): Subscription.Subscription<Msg, Device.ColorScheme.ColorScheme> =>
  Subscription.make(
    'Phone/colorScheme',
    Stream.unwrap(
      ColorScheme.ColorScheme.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('colorScheme', service.schemes), toMessage)),
      ),
    ),
  )
