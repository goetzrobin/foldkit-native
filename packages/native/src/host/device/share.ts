/**
 * The system share sheet: hand a piece of text or a link to another app.
 *
 *   // app entry
 *   import { Platform, Share as NativeShare } from 'react-native'
 *   const resources = Share.live(NativeShare, Platform.OS)
 *
 *   // update
 *   commands: [
 *     Command.mapMessage(
 *       Share.Open({ message: 'Look at this', url: 'https://foldkit.dev' }),
 *       message => Message.GotShareMessage({ message }),
 *     ),
 *   ]
 *
 * `SucceededShare` says whether something took the content (`shared`) or the
 * sheet was closed (`dismissed`). Android cannot tell the two apart and
 * always answers `shared`.
 */
import { Context, Effect, Layer, Schema } from 'effect'

import { DeviceError, attempt, makeFailure } from './common.js'

export type ShareRequest = Readonly<{
  /** Text to share. */
  message?: string | undefined
  /** A link to share. */
  url?: string | undefined
  /** Android's sheet title, and the subject when shared to mail. */
  title?: string | undefined
}>

export const ShareOutcome = Schema.Literals(['shared', 'dismissed'])
export type ShareOutcome = typeof ShareOutcome.Type

export type ShareService = Readonly<{
  share: (request: ShareRequest) => Effect.Effect<ShareOutcome, DeviceError>
}>

export class Share extends Context.Service<Share, ShareService>()('foldkit-native/Share') {}

/** The part of React Native's `Share` used here. */
export interface ShareModule {
  share(content: any, options?: any): Promise<{ action: string }>
}

/**
 * React Native's Android share reads `title` and `message` and ignores
 * `url`, so a request with only a link would open a sheet with nothing in
 * it. The link is folded into the message there.
 */
const forPlatform = (request: ShareRequest, platform: string): Record<string, string> => {
  const { message, url, title } = request
  const content: Record<string, string> = {}
  if (title !== undefined) content['title'] = title
  if (platform === 'android') {
    const text = [message, url].filter(part => part !== undefined && part !== '').join('\n')
    if (text !== '') content['message'] = text
    return content
  }
  if (message !== undefined) content['message'] = message
  if (url !== undefined) content['url'] = url
  return content
}

/** `Share.live(Share, Platform.OS)` with both taken from `react-native`. */
export const live = (module: ShareModule, platform: string): Layer.Layer<Share> =>
  Layer.succeed(Share, {
    share: request => {
      const content = forPlatform(request, platform)
      if (content['message'] === undefined && content['url'] === undefined) {
        return Effect.fail(
          new DeviceError({ capability: 'share', reason: 'Nothing to share: give a message or a url' }),
        )
      }
      return Effect.map(
        attempt('share', () => module.share(content)),
        (result): ShareOutcome => (result.action === 'dismissedAction' ? 'dismissed' : 'shared'),
      )
    },
  })

/** A fake sheet. `calls` holds each request. `answerWith` sets what the next shares report. */
export const makeTest = () => {
  const calls: Array<ShareRequest> = []
  let outcome: ShareOutcome = 'shared'
  const { failNext, guard } = makeFailure('share')
  const layer = Layer.succeed(Share, {
    share: request =>
      guard(() => {
        calls.push(request)
        return outcome
      }),
  })
  return {
    layer,
    calls,
    failNext,
    answerWith: (next: ShareOutcome) => {
      outcome = next
    },
  }
}
