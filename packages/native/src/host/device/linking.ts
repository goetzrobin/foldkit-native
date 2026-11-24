/**
 * Links: open a URL in whichever app handles it, and ask whether one does.
 *
 *   // app entry
 *   import { Linking as NativeLinking } from 'react-native'
 *   const resources = Linking.live(NativeLinking)
 *
 *   // update
 *   commands: [
 *     Command.mapMessage(Linking.OpenUrl({ url: 'https://foldkit.dev' }), message =>
 *       Message.GotLinkingMessage({ message })),
 *   ]
 *
 * `https:` links open the browser. `tel:`, `mailto:` and `sms:` open the
 * phone's own apps. Opening fails with `FailedOpenUrl` when no app takes the
 * link. On iOS, `CanOpenUrl` answers false for another app's scheme unless
 * the app's Info.plist lists it under `LSApplicationQueriesSchemes`.
 */
import { Context, Effect, Layer, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError, attempt, makeFailure } from './common.js'

export type LinkingService = Readonly<{
  open: (url: string) => Effect.Effect<void, DeviceError>
  canOpen: (url: string) => Effect.Effect<boolean, DeviceError>
}>

export class Linking extends Context.Service<Linking, LinkingService>()(
  'foldkit-native/Linking',
) {}

/** The part of React Native's `Linking` used here. */
export interface LinkingModule {
  openURL(url: string): Promise<unknown>
  canOpenURL(url: string): Promise<boolean>
}

export const live = (module: LinkingModule): Layer.Layer<Linking> =>
  Layer.succeed(Linking, {
    open: url => Effect.asVoid(attempt('linking', () => module.openURL(url))),
    canOpen: url => attempt('linking', () => module.canOpenURL(url)),
  })

/**
 * A fake that opens nothing. `opened` lists the URLs asked for. It takes any
 * URL whose scheme is in `schemes`, and fails for the rest as the phone does.
 */
export const makeTest = (schemes: ReadonlyArray<string> = ['https', 'http', 'mailto', 'tel']) => {
  const opened: Array<string> = []
  const asked: Array<string> = []
  const { failNext, guard } = makeFailure('linking')
  const takes = (url: string): boolean => schemes.some(scheme => url.startsWith(`${scheme}:`))
  const layer = Layer.succeed(Linking, {
    open: url =>
      Effect.flatMap(
        guard(() => {
          opened.push(url)
          return takes(url)
        }),
        isTaken =>
          isTaken
            ? Effect.void
            : Effect.fail(
                new DeviceError({
                  capability: 'linking',
                  reason: `No app on this phone opens ${url}`,
                }),
              ),
      ),
    canOpen: url =>
      guard(() => {
        asked.push(url)
        return takes(url)
      }),
  })
  return { layer, opened, asked, failNext }
}

export const Message = defineMessageUnion({
  SucceededOpenUrl: { url: Schema.String },
  FailedOpenUrl: { url: Schema.String, reason: Schema.String },
  SucceededCanOpenUrl: { url: Schema.String, canOpen: Schema.Boolean },
  FailedCanOpenUrl: { url: Schema.String, reason: Schema.String },
})
export type Message = typeof Message.Type

/** Leaves the app for whichever app handles `url`. */
export const OpenUrl = Command.define('Linking.OpenUrl', {
  args: { url: Schema.String },
  messages: [Message.SucceededOpenUrl, Message.FailedOpenUrl],
  execute: ({ url }) =>
    Linking.use(linking => linking.open(url)).pipe(
      Effect.as(Message.SucceededOpenUrl({ url })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedOpenUrl({ url, reason: error.reason })),
      ),
    ),
})

/** Asks whether some app on the phone handles `url`, without opening it. */
export const CanOpenUrl = Command.define('Linking.CanOpenUrl', {
  args: { url: Schema.String },
  messages: [Message.SucceededCanOpenUrl, Message.FailedCanOpenUrl],
  execute: ({ url }) =>
    Linking.use(linking => linking.canOpen(url)).pipe(
      Effect.map(canOpen => Message.SucceededCanOpenUrl({ url, canOpen })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedCanOpenUrl({ url, reason: error.reason })),
      ),
    ),
})
