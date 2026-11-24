/**
 * Small questions with yes or no answers, for a screen that shows what this
 * build of the app can do on the UI thread. None of them throws.
 */
import { type Check, gesturesCheck, uiRuntimeCheck, viewUpdatesCheck } from './host.js'
import { readShared, runOnUiSync, shared } from './run.js'
import { addOnUi, whereAmI } from './ui.js'

const UI_RUNTIME = 2

/** Runs a worklet and asks it which JavaScript engine it found itself on. */
export const ranOnUiCheck = (): Check => {
  const answer = runOnUiSync(whereAmI)
  if (!answer.ok) return answer
  return answer.value.kind === UI_RUNTIME
    ? { ok: true, reason: '' }
    : { ok: false, reason: `the worklet ran, but on engine ${answer.value.kind}, not the UI thread's` }
}

/**
 * Makes a shared value on the JavaScript thread, changes it on the UI
 * thread, and reads it back on the JavaScript thread.
 */
export const sharedRoundTripCheck = (): Check => {
  const runtime = uiRuntimeCheck()
  if (!runtime.ok) return runtime
  try {
    const value = shared(1)
    const added = runOnUiSync(addOnUi, value, 41)
    if (!added.ok) return added
    const back = readShared(value)
    return added.value === 42 && back === 42
      ? { ok: true, reason: '' }
      : { ok: false, reason: `sent 1, added 41 on the UI thread, read back ${String(back)}` }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export type WorkletsStatus = Readonly<{
  /** There is a JavaScript engine on the UI thread. */
  uiRuntime: Check
  /** A worklet ran there. */
  ranOnUi: Check
  /** A value went to the UI thread, was changed there, and came back. */
  sharedRoundTrip: Check
  /** Native code that lets a worklet change a view has started. */
  viewUpdates: Check
  /** Native code that reads gestures on the UI thread is there. */
  gestures: Check
}>

/** Everything that can be answered at once. Call it after the first draw. */
export const workletsStatus = (): WorkletsStatus => ({
  uiRuntime: uiRuntimeCheck(),
  ranOnUi: ranOnUiCheck(),
  sharedRoundTrip: sharedRoundTripCheck(),
  viewUpdates: viewUpdatesCheck(),
  gestures: gesturesCheck(),
})
