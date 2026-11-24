/**
 * Android's Back button (and its back gesture), as a Foldkit Subscription.
 *
 * Android asks a question with each press: does anybody want this? The
 * answer must come at once, before `update` has run. So the Subscription
 * answers from the Model as it stands: if the Model says there is somewhere
 * to go back to, the press is taken and becomes a Message, and `update` pops
 * the screen. If not, the press is declined and Android does what it always
 * does at the bottom of an app: it leaves the app.
 *
 *   const subscriptions = Subscription.make<Model, Message>()(() => ({
 *     back: hardwareBack(backSource, {
 *       canGoBack: model => model.screens.length > 1,
 *       toMessage: () => PressedHardwareBack(),
 *     }),
 *   }))
 *
 * react-native-screens leaves this button to JavaScript. Without this
 * Subscription a press leaves the app, however many screens are open.
 *
 * The presses come from React Native's `BackHandler`. This package does not
 * import `react-native`, so the app hands it in:
 *
 *   import { BackHandler } from 'react-native'
 *   const backSource = backSourceFrom(BackHandler)
 *
 * iOS has no such button and never calls the listener.
 */
import { Effect, Queue, Schema, Stream } from 'effect'

/** Where presses come from. A test makes its own and presses it by hand. */
export type BackSource = Readonly<{
  /** `listener` answers whether it took the press. Returns the unsubscribe. */
  subscribe: (listener: () => boolean) => () => void
}>

/** The part of React Native's `BackHandler` this needs. */
export type BackHandlerLike = Readonly<{
  addEventListener: (
    event: 'hardwareBackPress',
    handler: () => boolean,
  ) => Readonly<{ remove: () => void }>
}>

/** A `BackSource` over React Native's `BackHandler`. */
export const backSourceFrom = (backHandler: BackHandlerLike): BackSource => ({
  subscribe: listener => {
    const subscription = backHandler.addEventListener('hardwareBackPress', listener)
    return () => subscription.remove()
  },
})

/** A source that never presses, for a program run where there is no button. */
export const noBackSource: BackSource = { subscribe: () => () => {} }

export type HardwareBackConfig<Model, Message> = Readonly<{
  /** Whether a press has anywhere to go. False lets Android leave the app. */
  canGoBack: (model: Model) => boolean
  toMessage: () => Message
}>

type Dependencies = Readonly<{ canGoBack: boolean }>

/**
 * A Subscription entry for the Back button. Pass it into `Subscription.make`
 * as an entry value.
 *
 * It listens once and keeps listening while the Model changes, reading the
 * newest `canGoBack` at each press. Subscribing again on every change would
 * move this listener ahead of ones added later, and React Native asks the
 * newest listener first.
 */
export const hardwareBack = <Model, Message>(
  source: BackSource,
  config: HardwareBackConfig<Model, Message>,
) => ({
  dependenciesSchema: Schema.Struct({ canGoBack: Schema.Boolean }),
  modelToDependencies: (model: Model): Dependencies => ({ canGoBack: config.canGoBack(model) }),
  // Never restart: see above.
  keepAliveEquivalence: (): boolean => true,
  dependenciesToStream: (
    _dependencies: Dependencies,
    readDependencies: () => Dependencies,
  ): Stream.Stream<Message> =>
    Stream.callback<Message>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          source.subscribe(() => {
            if (!readDependencies().canGoBack) return false
            Queue.offerUnsafe(queue, config.toMessage())
            return true
          }),
        ),
        stop => Effect.sync(stop),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
})
