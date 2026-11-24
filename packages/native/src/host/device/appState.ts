/**
 * Whether the app is in front of the user.
 *
 *   // app entry
 *   import { AppState as NativeAppState } from 'react-native'
 *   const resources = AppState.live(NativeAppState)
 *
 *   // subscriptions
 *   appState: AppState.changesEntry(message => Message.GotAppStateMessage({ message })),
 *
 * `active` is in front and taking touches. `background` is out of sight.
 * `inactive` is iOS only: in between, as when the app switcher is open or a
 * call comes in. To stop work when the user is not looking, test for
 * "not active", not for "background".
 */
import { Context, Layer, Schema } from 'effect'

import { type NativeSubscription, type Source, makeTestSource } from './common.js'

export const AppStatus = Schema.Literals(['active', 'background', 'inactive'])
export type AppStatus = typeof AppStatus.Type

export type AppStateService = Readonly<{ statuses: Source<AppStatus> }>

export class AppState extends Context.Service<AppState, AppStateService>()(
  'foldkit-native/AppState',
) {}

/** The part of React Native's `AppState` used here. */
export interface AppStateModule {
  currentState: string | null | undefined
  addEventListener(event: any, listener: (state: any) => void): NativeSubscription
}

/** React Native also reports `unknown` and `extension`. Both count as active. */
const known = (state: string | null | undefined): AppStatus =>
  state === 'background' || state === 'inactive' ? state : 'active'

export const live = (module: AppStateModule): Layer.Layer<AppState> =>
  Layer.succeed(AppState, {
    statuses: {
      subscribe: listener => {
        const subscription = module.addEventListener('change', (state: string) =>
          listener(known(state)),
        )
        listener(known(module.currentState))
        return () => subscription.remove()
      },
    },
  })

/** A fake. `set('background')` is the user leaving the app. */
export const makeTest = (initial: AppStatus = 'active') => {
  const statuses = makeTestSource<AppStatus>(initial)
  return {
    layer: Layer.succeed(AppState, { statuses: statuses.source }),
    set: statuses.emit,
    listenerCount: statuses.listenerCount,
  }
}
