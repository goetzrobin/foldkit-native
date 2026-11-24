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
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError, attempt, makeFailure, reasonOf } from './common.js'

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

export const Message = defineMessageUnion({
  SucceededGetItem: { key: Schema.String, maybeValue: Schema.Option(Schema.String) },
  FailedGetItem: { key: Schema.String, reason: Schema.String },
  SucceededSetItem: { key: Schema.String },
  FailedSetItem: { key: Schema.String, reason: Schema.String },
  SucceededRemoveItem: { key: Schema.String },
  FailedRemoveItem: { key: Schema.String, reason: Schema.String },
})
export type Message = typeof Message.Type

export const GetItem = Command.define('Storage.GetItem', {
  args: { key: Schema.String },
  messages: [Message.SucceededGetItem, Message.FailedGetItem],
  execute: ({ key }) =>
    Storage.use(storage => storage.get(key)).pipe(
      Effect.map(maybeValue => Message.SucceededGetItem({ key, maybeValue })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedGetItem({ key, reason: error.reason })),
      ),
    ),
})

export const SetItem = Command.define('Storage.SetItem', {
  args: { key: Schema.String, value: Schema.String },
  messages: [Message.SucceededSetItem, Message.FailedSetItem],
  execute: ({ key, value }) =>
    Storage.use(storage => storage.set(key, value)).pipe(
      Effect.as(Message.SucceededSetItem({ key })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSetItem({ key, reason: error.reason })),
      ),
    ),
})

export const RemoveItem = Command.define('Storage.RemoveItem', {
  args: { key: Schema.String },
  messages: [Message.SucceededRemoveItem, Message.FailedRemoveItem],
  execute: ({ key }) =>
    Storage.use(storage => storage.remove(key)).pipe(
      Effect.as(Message.SucceededRemoveItem({ key })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedRemoveItem({ key, reason: error.reason })),
      ),
    ),
})

/** A Schema whose values can be written as JSON text without outside help. */
type Storable<A> = Schema.Codec<A, any, never, never>

/**
 * Reads the value saved under `key` and decodes it with `schema`.
 * `Option.none()` when nothing is saved, or when what is saved does not fit
 * the Schema any more (an older version of the app wrote it).
 */
export const restore = <A>(
  key: string,
  schema: Storable<A>,
): Effect.Effect<Option.Option<A>, DeviceError, Storage> => {
  const decode = Schema.decodeEffect(Schema.fromJsonString(Schema.toCodecJson(schema)))
  return Storage.use(storage => storage.get(key)).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<A>()),
        onSome: json =>
          decode(json).pipe(
            Effect.map(Option.some),
            Effect.catch(() => Effect.succeed(Option.none<A>())),
          ),
      }),
    ),
  )
}

/** Encodes `value` with `schema` and saves it under `key`. */
export const save = <A>(
  key: string,
  schema: Storable<A>,
  value: A,
): Effect.Effect<void, DeviceError, Storage> =>
  Schema.encodeEffect(Schema.fromJsonString(Schema.toCodecJson(schema)))(value).pipe(
    Effect.mapError(error => new DeviceError({ capability: 'storage', reason: reasonOf(error) })),
    Effect.flatMap(json => Storage.use(storage => storage.set(key, json))),
  )

/** What the Commands of one `persisted` slice report. */
export type PersistedMessage<A> =
  | Readonly<{ _tag: 'SucceededRestore'; key: string; maybeValue: Option.Option<A> }>
  | Readonly<{ _tag: 'FailedRestore'; key: string; reason: string }>
  | Readonly<{ _tag: 'SucceededSave'; key: string }>
  | Readonly<{ _tag: 'FailedSave'; key: string; reason: string }>

export type Persisted<A> = Readonly<{
  key: string
  /** The Schema of the Messages below, for the app's own Message union. */
  Message: Schema.Codec<PersistedMessage<A>, any, never, never>
  /** Reads the slice. Use in `init`'s commands. */
  Restore: () => Command.Command<PersistedMessage<A>, never, Storage>
  /** Writes the slice. */
  Save: (args: Readonly<{ value: A }>) => Command.Command<PersistedMessage<A>, never, Storage>
  /** The read as a plain Effect that cannot fail, for Foldkit's `flags`. */
  restore: Effect.Effect<Option.Option<A>, never, Storage>
}>

/**
 * One slice of a Model kept on the phone: a key, a Schema, and the two
 * Commands that read and write it. See the top of this file.
 */
export const persisted = <A>(
  config: Readonly<{ key: string; schema: Storable<A> }>,
): Persisted<A> => {
  const { key, schema } = config
  const SliceMessage = defineMessageUnion({
    SucceededRestore: { key: Schema.String, maybeValue: Schema.Option(schema) },
    FailedRestore: { key: Schema.String, reason: Schema.String },
    SucceededSave: { key: Schema.String },
    FailedSave: { key: Schema.String, reason: Schema.String },
  })
  // The Messages are built as plain objects below. Inside this function the
  // slice's type is still a parameter, which the union's constructors cannot
  // check, and outside it `Persisted<A>` gives callers the full types.
  const Restore = Command.define(`Storage.Restore(${key})`, {
    messages: [SliceMessage],
    execute: restore(key, schema).pipe(
      Effect.map(
        (maybeValue): PersistedMessage<A> => ({ _tag: 'SucceededRestore', key, maybeValue }),
      ),
      Effect.catch(error =>
        Effect.succeed<PersistedMessage<A>>({ _tag: 'FailedRestore', key, reason: error.reason }),
      ),
    ) as never,
  })
  const Save = Command.define(`Storage.Save(${key})`, {
    args: { value: schema },
    messages: [SliceMessage],
    execute: ({ value }: { value: unknown }) =>
      save(key, schema, value as A).pipe(
        Effect.as<PersistedMessage<A>>({ _tag: 'SucceededSave', key }),
        Effect.catch(error =>
          Effect.succeed<PersistedMessage<A>>({ _tag: 'FailedSave', key, reason: error.reason }),
        ),
      ) as never,
  } as never)
  return {
    key,
    Message: SliceMessage as unknown as Persisted<A>['Message'],
    Restore: Restore as unknown as Persisted<A>['Restore'],
    Save: Save as unknown as Persisted<A>['Save'],
    restore: Effect.catch(restore(key, schema), () => Effect.succeed(Option.none<A>())),
  }
}
