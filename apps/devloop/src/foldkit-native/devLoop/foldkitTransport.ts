/**
 * Plugs this store into Foldkit's own Model preservation.
 *
 * On the web Foldkit sends the encoded Model to the Vite dev server before a
 * reload and asks for it back on startup. The patched Foldkit fork lets a
 * host replace that Vite link with its own "transport". Ours is the store in
 * `store.ts`: nothing leaves the phone.
 *
 * With the transport in place every Foldkit program is kept across a hot
 * update, with no change to the program. A Foldkit without the patch has no
 * `setModelPreservationTransport`. Then this does nothing, and only programs
 * wrapped in `keepModel` are kept.
 */
import { Effect } from 'effect'
import * as Host from 'foldkit/renderTarget'

import { claim, onBeforeSwap, remember } from './store'

type Transport = Readonly<{
  preserve: (id: string, encodedModel: unknown, isReloadFlush: boolean) => void
  resolve: (id: string) => Effect.Effect<unknown>
  onBeforeReload: (flush: () => void) => () => void
}>

// Read through a loose type so this file compiles against a Foldkit with or
// without the patch.
const setTransport = (
  Host as unknown as {
    setModelPreservationTransport?: (transport: Transport) => () => void
  }
).setModelPreservationTransport

/** True when the installed Foldkit can keep any program's Model by itself. */
export const hasFoldkitTransport: boolean = typeof setTransport === 'function'

let isConnected = false

export const connectFoldkitTransport = (): void => {
  if (isConnected || setTransport === undefined) return
  isConnected = true
  setTransport({
    preserve: (id, encodedModel) => remember(id, () => encodedModel),
    resolve: id => Effect.sync(() => claim(id)),
    onBeforeReload: onBeforeSwap,
  })
}
