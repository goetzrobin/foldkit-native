/**
 * Starts Fold Chat on a screen, and starts it again from its crash screen.
 *
 * A crashed Foldkit program has stopped for good. The crash screen's Reload
 * button stops it and starts a new program on the same screen, over the same
 * saved chats, as a fresh launch would; Copy hands the error to `copy` (the
 * app puts it on the clipboard). Both run outside the stopped program.
 */
import type { Layer } from 'effect'
import { Runtime } from 'foldkit'

import { type ChatAppEnv, type ChatAppOptions, type ChatAppResources, makeChatApp } from './app.js'

export type StartOptions = ChatAppOptions &
  Readonly<{
    /** Puts the crash report somewhere the user can paste it from. */
    copy?: (text: string) => void
    /** Hears each program as it starts: the first one, and each after a Reload. */
    onStart?: (app: ReturnType<typeof makeChatApp>) => void
  }>

export const startChatApp = (
  container: HTMLElement,
  env: ChatAppEnv,
  resources: Layer.Layer<ChatAppResources>,
  options: StartOptions = {},
): Readonly<{ dispose: () => void }> => {
  let running: { dispose: () => void } | undefined
  let isStopped = false

  // Reload is pressed inside the stopped program's own press handler; the
  // swap waits until that handler has returned.
  const reload = (): void => {
    void Promise.resolve().then(() => {
      if (isStopped) return
      running?.dispose()
      start()
    })
  }

  const start = (): void => {
    const { copy, onStart, ...rest } = options
    const app = makeChatApp(container, env, resources, {
      ...rest,
      crash: { ...rest.crash, onReload: reload, ...(copy === undefined ? {} : { onCopy: copy }) },
    })
    onStart?.(app)
    running = Runtime.embed(app.program)
  }

  start()
  return {
    dispose: () => {
      isStopped = true
      running?.dispose()
      running = undefined
    },
  }
}
