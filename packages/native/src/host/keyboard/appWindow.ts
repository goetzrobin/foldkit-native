/**
 * Measures how tall the app's own window is right now.
 *
 * It is for one question on Android: when the keyboard opens, does the
 * system make the app's window shorter by itself? Most Android apps are set
 * up that way, Expo Go among them, and then the app must NOT also make room
 * for the keyboard, or the room is made twice and the messages are squeezed
 * out. An app's settings file cannot be trusted to answer (Expo Go ignores
 * it), so the window is measured before and after. See `../device/keyboard.ts`.
 *
 * The view measured is the one the surface made to fill the window. This
 * file finds it by walking up from any view the adapter has drawn.
 */
import type { EngineNode } from '@ng-native/fabric'

import { type ModuleFactory, registerModule } from '../../foldkit/extend.js'
import { nodeOf } from '../fabric/nodes.js'

type Measure = (use: (height: number) => void) => void

/** The surface now on screen. An app has one. */
let measure: Measure | undefined

const appWindowModule: ModuleFactory = engine => {
  let sample: EngineNode | undefined
  let windowView: EngineNode | undefined

  const find = (): EngineNode | undefined => {
    if (windowView !== undefined) return windowView
    let at = sample
    while (at !== undefined) {
      const parent = engine.parentNode(at)
      if (parent === null) return undefined
      if (parent === engine.root) {
        windowView = at
        return at
      }
      at = parent
    }
    return undefined
  }

  measure = use => {
    const view = find()
    if (view === undefined) return
    try {
      engine.measure(view, frame => use(frame.height))
    } catch {
      // No answer is an answer: the caller then assumes nothing.
    }
  }

  return {
    create: (_empty, vnode) => {
      if (windowView !== undefined) return
      // Any view will do. It is not yet in the tree here, so the walk up
      // waits until someone asks.
      sample = nodeOf(vnode) ?? sample
    },
  }
}

registerModule(appWindowModule)

/**
 * Asks for the height of the app's window, in points. `use` is called when
 * the phone answers, and not at all if nothing has been drawn yet.
 */
export const measureAppWindow: Measure = use => measure?.(use)
