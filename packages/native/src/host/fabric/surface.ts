/**
 * A place on the phone screen to draw into, with no view library attached.
 *
 * It starts ng-native's engine on the screen the phone gave, puts one view
 * that fills it under the root and commits that at once, and commits again
 * whenever the engine changes something on its own clock. A view library
 * then draws inside that view (see `src/foldkit/mount.ts` for Foldkit's).
 */
import {
  Engine,
  type EngineNode,
  type EngineOptions,
  type FabricUIManager,
} from '@ng-native/fabric'

import { stopMotion } from '../motion/clock.js'

export type HostSurfaceOptions = EngineOptions &
  Readonly<{
    /**
     * EXPERIMENT. On a first launch in Expo Go the first screen came up with
     * its content missing until the app was reloaded. With this on, the
     * surface commits again 0.1, 0.5 and 1.5 seconds after the first draw.
     * If the content then appears by itself, the first draw came too early.
     */
    recommitAfterFirstDraw?: boolean
  }>

export type HostSurface = Readonly<{
  engine: Engine
  /** Queues work for after the current draw has reached the phone. */
  afterCommit: (job: () => void) => void
  /** Sends the current draw to the phone, then runs what was queued for after it. */
  commit: () => void
  /** A placeholder inside the full-screen view, for the first draw to replace. */
  placeholder: () => EngineNode
  /** Takes away what the view library left in the full-screen view, and commits. */
  release: (left: EngineNode | undefined) => void
  /** See `recommitAfterFirstDraw`. Call as the first draw starts. */
  scheduleNudges: () => void
  /**
   * Stops drawing and releases the engine. `beforeEngine` runs after the
   * surface's own timers and motion have stopped and before the engine goes.
   */
  dispose: (beforeEngine?: () => void) => void
}>

const HOST_STYLE = { height: '100%' } as const

export const createHostSurface = (
  fabric: FabricUIManager,
  rootTag: number,
  options: HostSurfaceOptions,
  /** Runs once the engine exists and before anything is drawn: build the updater here. */
  prepare: (engine: Engine, afterCommit: (job: () => void) => void) => void,
): HostSurface => {
  const { recommitAfterFirstDraw = false, ...engineOptions } = options
  const engine = new Engine(fabric, rootTag, engineOptions)
  // Work that needs the latest draw to have reached the phone first.
  const afterCommitJobs: Array<() => void> = []
  const afterCommit = (job: () => void): void => {
    afterCommitJobs.push(job)
  }
  prepare(engine, afterCommit)

  // Work the engine does on its own clock, such as a style transition, asks
  // for a commit here. One per task is enough.
  let isCommitQueued = false
  engine.setOnDirty(() => {
    if (isCommitQueued) return
    isCommitQueued = true
    queueMicrotask(() => {
      isCommitQueued = false
      engine.commit()
    })
  })

  // A view that fills the screen, committed now, in the same turn the phone
  // started this surface. ng-native does the same. The program draws inside
  // it a frame later. Without it the first screen stayed blank on a real
  // iPhone until the app was sent to the background and brought back.
  const host = engine.createElement('view')
  engine.appendChild(engine.root, host)
  engine.setDefaultStyle(host, HOST_STYLE)
  engine.commit()

  const nudges: Array<ReturnType<typeof setTimeout>> = []

  return {
    engine,
    afterCommit,
    commit: () => {
      engine.commit()
      for (const job of afterCommitJobs.splice(0)) job()
    },
    placeholder: () => {
      const placeholder = engine.createAnchor()
      engine.appendChild(host, placeholder)
      return placeholder
    },
    release: left => {
      if (left !== undefined) {
        engine.removeChild(host, left)
        engine.destroyNode(left)
      }
      engine.commit()
    },
    scheduleNudges: () => {
      if (!recommitAfterFirstDraw) return
      for (const [index, delay] of [100, 500, 1500].entries()) {
        nudges.push(
          setTimeout(() => {
            // A changed prop makes a real commit: one that changes nothing is skipped.
            engine.setProp(host, 'nativeID', `foldkit-host-${index}`)
            engine.commit()
          }, delay),
        )
      }
    },
    dispose: beforeEngine => {
      for (const nudge of nudges) clearTimeout(nudge)
      // A queued animation frame must not commit on an engine that is gone.
      stopMotion({ engine })
      beforeEngine?.()
      // Newer engines have a `dispose`. The published 0.25.0 does not.
      ;(engine as { dispose?: () => void }).dispose?.()
    },
  }
}
