/**
 * What every part of Fold Chat reads and no part owns: the colour scheme,
 * the saved settings, the network, the keyboard, the clock. The app keeps it
 * at the top of its Model and hands it down to each part's view as an input.
 *
 * In Effect UI this is a Provider: a part reads it where it needs it, and
 * replay records what each Message's update read from it.
 */
import { Schema } from 'effect'

import type { Services } from '../src/device/index.js'
import type { Device } from '../src/foldkit/navigation/stack.js'
import type { ActionSheet } from '../src/menus/index.js'
import type { ServerState } from '../src/serverState/index.js'
import type { Appearance } from './appearance.js'
import { ChaosSchema, Settings } from './model.js'

export const Shared = Schema.Struct({
  /** Light or dark, as the phone shows it now. */
  scheme: Schema.Literals(['light', 'dark']),
  settings: Settings,
  /** The pretend server's failure switches. Not kept between launches. */
  chaos: ChaosSchema,
  /** The developer overlay with the list's and the keyboard's numbers. */
  showsNumbers: Schema.Boolean,
  /** The clock when the list was last read, for "Today" and "Yesterday". */
  nowMs: Schema.Number,
  isOnline: Schema.Boolean,
  keyboardHeight: Schema.Number,
  keyboardCovers: Schema.Number,
})
export type Shared = typeof Shared.Type

/** What a part's view is given from above: the shared values and the phone. */
export type Context = Readonly<{ shared: Shared; device: Device }>

/** Everything the program's Commands and Subscriptions may ask for. */
export type Resources =
  | Services
  | ActionSheet.ActionSheet
  | Appearance
  | ServerState
