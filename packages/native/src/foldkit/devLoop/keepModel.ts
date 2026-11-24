/**
 * Marks one program's Model as worth keeping across a hot update:
 *
 *   Runtime.makeElement(keepModel({ Model, init, update, view, container }))
 *
 * It wraps `update` to note the newest Model, and `init` to start from the
 * Model the previous run left, when there is one and it still fits the Model
 * schema. If it no longer fits (a field was added or changed type), the
 * program starts fresh, as it does on the web.
 *
 * This needs nothing from Foldkit, so it works with a Foldkit that lacks the
 * preservation transport (see `foldkitTransport.ts`). With the transport it
 * is harmless: Foldkit restores the Model first and never calls `init`.
 *
 * Outside a hot update nothing is ever claimed, so `init` runs as written.
 */
import { Exit, Schema } from 'effect'

import { claim, remember } from '../../host/devLoop/store.js'

type Keepable = Readonly<{
  Model: Schema.Top
  init: (...args: Array<any>) => Readonly<{ model: any }>
  update: (model: any, message: any) => Readonly<{ model: any }>
  container: Readonly<{ id: string }>
}>

export const keepModel = <Config extends Keepable>(config: Config): Config => {
  const id = config.container.id
  // The same plain-data form Foldkit's own preservation uses.
  const codec = Schema.toCodecJson(config.Model as Schema.Codec<unknown>)
  const encode = Schema.encodeUnknownSync(codec)
  const decode = Schema.decodeUnknownExit(codec)

  const init = (...args: Array<any>) => {
    const kept = claim(id)
    if (kept !== undefined) {
      const decoded = decode(kept)
      if (Exit.isSuccess(decoded)) return { model: decoded.value }
      console.warn(
        `[foldkit-native] The Model kept for "${id}" no longer fits its schema. Starting fresh.`,
      )
    }
    return config.init(...args)
  }

  const update = (model: unknown, message: unknown) => {
    const result = config.update(model, message)
    remember(id, () => encode(result.model))
    return result
  }

  return { ...config, init, update }
}
