/**
 * The way back from the UI thread to Foldkit.
 *
 * A worklet cannot dispatch a Foldkit Message: Foldkit lives on the
 * JavaScript thread. It can call `sendMessage(channel, name, detail)`
 * (`ui.ts`), which crosses to the JavaScript thread and lands in `deliver`
 * here. Whoever listens to the channel turns it into a Message. For an
 * element that is `onUiMessage` plus `uiThread({ channel })` (`views.ts`).
 *
 * A channel is only a number in a plain object, so it can be copied to the
 * UI thread like any other value.
 */
export type UiChannel = Readonly<{ id: number }>

type Listener = (name: string, detail: unknown) => void

let nextId = 1
const listeners = new Map<number, Set<Listener>>()

/** Make one per thing that sends: once, outside the view. */
export const uiChannel = (): UiChannel => ({ id: nextId++ })

/** Hears everything sent on the channel. Returns how to stop. */
export const listenToChannel = (channel: UiChannel, listener: Listener): (() => void) => {
  let heard = listeners.get(channel.id)
  if (heard === undefined) listeners.set(channel.id, (heard = new Set()))
  heard.add(listener)
  return () => {
    heard.delete(listener)
    if (heard.size === 0) listeners.delete(channel.id)
  }
}

/** Runs on the JavaScript thread. Called by `sendMessage`. Never throws. */
export const deliver = (channelId: number, name: string, detail: unknown): void => {
  const heard = listeners.get(channelId)
  if (heard === undefined) return
  for (const listener of [...heard]) {
    try {
      listener(name, detail)
    } catch {
      // One listener failing must not stop the others, or reach native code.
    }
  }
}
