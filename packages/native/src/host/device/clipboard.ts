/**
 * The clipboard: copy text, and read what is there.
 *
 *   // app entry
 *   import * as ExpoClipboard from 'expo-clipboard'
 *   const resources = Clipboard.live(ExpoClipboard)
 *
 *   // update
 *   PressedCopy: () => ({
 *     model,
 *     commands: [
 *       Command.mapMessage(Clipboard.CopyText({ text: model.draft }), message =>
 *         Message.GotClipboardMessage({ message })),
 *     ],
 *   })
 *
 * On iOS 16 and later, reading shows the system's "Allow Paste" question
 * unless the text was copied by this app. Read when the user asks to paste,
 * never on a timer.
 */
import { Context, Effect, Layer } from 'effect'

import { type DeviceError, attempt, makeFailure } from './common.js'

export type ClipboardService = Readonly<{
  copy: (text: string) => Effect.Effect<void, DeviceError>
  read: Effect.Effect<string, DeviceError>
}>

export class Clipboard extends Context.Service<Clipboard, ClipboardService>()(
  'foldkit-native/Clipboard',
) {}

/** The part of `expo-clipboard` used here. */
export interface ClipboardModule {
  getStringAsync(): Promise<string>
  setStringAsync(text: string): Promise<boolean>
}

export const live = (module: ClipboardModule): Layer.Layer<Clipboard> =>
  Layer.succeed(Clipboard, {
    copy: text => Effect.asVoid(attempt('clipboard', () => module.setStringAsync(text))),
    read: attempt('clipboard', () => module.getStringAsync()),
  })

/** A fake clipboard. `calls` lists `copy:<text>` and `read`; `contents()` is what it holds. */
export const makeTest = (initial = '') => {
  const calls: Array<string> = []
  let text = initial
  const { failNext, guard } = makeFailure('clipboard')
  const layer = Layer.succeed(Clipboard, {
    copy: copied =>
      guard(() => {
        calls.push(`copy:${copied}`)
        text = copied
      }),
    read: guard(() => {
      calls.push('read')
      return text
    }),
  })
  return {
    layer,
    calls,
    failNext,
    contents: () => text,
    /** As if another app had copied something. */
    setContents: (value: string) => {
      text = value
    },
  }
}
