/**
 * Three ways to break the app on purpose, so the crash screen can be seen on
 * a phone. They sit at the bottom of the Phone screen, out of the way.
 *
 * - In update: the function that handles the press throws.
 * - In view: the next draw throws.
 * - In a Command: work started by the press dies with an error nobody
 *   declared.
 *
 * Each one stops this part of the app. `NativeCrash.screen` hears it and
 * shows the crash screen in place of the whole app.
 */
import { Command, UiSchema } from '@effect/ui'
import { Effect, Schema } from 'effect'

import { Native } from '../src/index.js'
import * as Look from './look.js'

const REASON = 'This crash was made on purpose.'

export const CrashMessage = UiSchema.TaggedEnum({
  PressedCrash: {},
  PressedCrashView: {},
  PressedCrashCommand: {},
  Broke: {},
})

const Break = Command.make('Playground/Break', { args: {} }, () => Effect.die(new Error(REASON)))

export const CrashButtons = Native.component({
  name: 'CrashButtons',
  model: Schema.Struct({ isViewBroken: Schema.Boolean }),
  message: CrashMessage,
}).make({
  init: () => ({ isViewBroken: false }),
  update: {
    PressedCrash: () => {
      throw new Error(REASON)
    },
    PressedCrashView: $ => $.evolve({ isViewBroken: true }),
    PressedCrashCommand: $ => $.run(Break.make({}).pipe(Command.as(CrashMessage.Broke()))),
    Broke: $ => $.model,
  },
  view: (h, model) => {
    if (model.isViewBroken) throw new Error(REASON)
    const quiet = (id: string, words: string, message: typeof CrashMessage.Type) =>
      h.pressable
        .testId(id)
        .set({ accessibilityRole: 'button', accessibilityLabel: `Crash ${words}` })
        .style({ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: Look.LINE })
        .pressedStyle(Look.buttonPressed)
        .on('press', message)
        .children(h.text.style({ fontSize: 13, lineHeight: 18, color: Look.DIM }).children(words))
    return h.view.testId('crash-buttons-row').style({ gap: 8, marginTop: 24 }).children(
      h.text.style(Look.small).children('Crash on purpose, to see the crash screen:'),
      h.view.style({ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }).children(
        quiet('crash-update', 'in update', CrashMessage.PressedCrash()),
        quiet('crash-view', 'in view', CrashMessage.PressedCrashView()),
        quiet('crash-command', 'in a Command', CrashMessage.PressedCrashCommand()),
      ),
    )
  },
})
