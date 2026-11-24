/**
 * Storage: small strings kept on the phone between launches, by key.
 *
 *   // app entry: the keychain (iOS) and keystore (Android)
 *   import * as SecureStore from 'expo-secure-store'
 *   const resources = Storage.liveSecureStore(SecureStore)
 *
 * Three Commands work on plain strings: `GetItem`, `SetItem`, `RemoveItem`.
 *
 * To keep part of a Model, describe it once with `persisted`:
 *
 *   const Settings = Schema.Struct({ name: Schema.String })
 *   const SavedSettings = Storage.persisted({ key: 'settings', schema: Settings })
 *
 *   // init: ask for it at startup
 *   commands: [Command.mapMessage(SavedSettings.Restore(), toMessage)]
 *   // update: when it changes
 *   commands: [Command.mapMessage(SavedSettings.Save({ value }), toMessage)]
 *   // update: SucceededRestore carries Option.some(value), or none when
 *   // nothing was saved or what was saved no longer fits the Schema.
 *
 * `SavedSettings.restore` is the same read as a plain Effect, for a program
 * that prefers Foldkit's `flags` and wants the value before the first draw.
 *
 * Keys for the secure store may hold letters, digits, `.`, `-` and `_` only.
 * It is meant for small values: iOS accepts more, but Expo warns above about
 * 2 kilobytes. Use an AsyncStorage-shaped store for anything large.
 */
import { Context, Effect, Layer, Option } from 'effect'

import { DeviceError, attempt, makeFailure } from './common.js'

export type StorageService = Readonly<{
  /** The string saved under `key`, if any. */
  get: (key: string) => Effect.Effect<Option.Option<string>, DeviceError>
  set: (key: string, value: string) => Effect.Effect<void, DeviceError>
  remove: (key: string) => Effect.Effect<void, DeviceError>
}>

export class Storage extends Context.Service<Storage, StorageService>()(
  'foldkit-native/Storage',
) {}

/** The part of `expo-secure-store` used here. */
export interface SecureStoreModule {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

/** The shape of `@react-native-async-storage/async-storage`'s default export. */
export interface AsyncStorageModule {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** Storage in the keychain (iOS) and the keystore (Android). */
export const liveSecureStore = (module: SecureStoreModule): Layer.Layer<Storage> =>
  Layer.succeed(Storage, {
    get: key =>
      Effect.map(
        attempt('storage', () => module.getItemAsync(key)),
        Option.fromNullishOr,
      ),
    set: (key, value) => attempt('storage', () => module.setItemAsync(key, value)),
    remove: key => attempt('storage', () => module.deleteItemAsync(key)),
  })

/** Storage in a plain, unencrypted key-value file. */
export const liveAsyncStorage = (module: AsyncStorageModule): Layer.Layer<Storage> =>
  Layer.succeed(Storage, {
    get: key =>
      Effect.map(
        attempt('storage', () => module.getItem(key)),
        Option.fromNullishOr,
      ),
    set: (key, value) => attempt('storage', () => module.setItem(key, value)),
    remove: key => attempt('storage', () => module.removeItem(key)),
  })

/**
 * A fake store in memory. `items` is what it holds, and survives for as long
 * as the object does, so a test can start a second program on the same one
 * to stand for closing and reopening the app. `calls` lists `get:<key>`,
 * `set:<key>=<value>` and `remove:<key>`.
 */
export const makeTest = (initial: Readonly<Record<string, string>> = {}) => {
  const items = new Map<string, string>(Object.entries(initial))
  const calls: Array<string> = []
  const { failNext, guard } = makeFailure('storage')
  const layer = Layer.succeed(Storage, {
    get: key =>
      guard(() => {
        calls.push(`get:${key}`)
        return Option.fromNullishOr(items.get(key))
      }),
    set: (key, value) =>
      guard(() => {
        calls.push(`set:${key}=${value}`)
        items.set(key, value)
      }),
    remove: key =>
      guard(() => {
        calls.push(`remove:${key}`)
        items.delete(key)
      }),
  })
  return { layer, calls, items, failNext }
}
