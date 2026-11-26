/**
 * Phone: the phone's services through Commands and Subscriptions.
 *
 * - Haptic: three buttons, each a tap you should feel.
 * - Clipboard: Copy puts a line of text on the clipboard, Paste reads it back.
 * - Keyboard: tap the field. The height of the keyboard is shown, and
 *   "Put keyboard away" puts it away.
 * - Colour scheme and app state: change the phone to dark mode, or leave the
 *   app and come back, and the lines change.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native, Phone } from '../src/index.js'
import { CrashButtons } from './crash.js'
import * as Look from './look.js'

export const PhoneMessage = UiSchema.TaggedEnum({
  PressedImpact: { style: Phone.Device.Haptics.ImpactStyle },
  PressedNotify: {},
  CompletedHaptic: { outcome: Phone.Outcome },
  PressedCopy: {},
  CompletedCopy: { outcome: Phone.Outcome },
  PressedPaste: {},
  CompletedPaste: { pasted: Phone.Pasted },
  ChangedField: { text: Schema.String },
  PressedDismiss: {},
  ChangedKeyboard: { height: Schema.Number },
  ChangedScheme: { scheme: Phone.Device.ColorScheme.Scheme },
  ChangedAppState: { status: Phone.Device.AppState.AppStatus },
})

const PhoneModel = Schema.Struct({
  taps: Schema.Number,
  haptic: Schema.String,
  copied: Schema.Number,
  clipboard: Schema.String,
  field: Schema.String,
  keyboardHeight: Schema.Number,
  scheme: Schema.String,
  appState: Schema.String,
  appStateChanges: Schema.Number,
})

export const PhoneScreen = Native.component({
  name: 'PhoneScreen',
  model: PhoneModel,
  message: PhoneMessage,
}).make({
  init: () => ({
    taps: 0,
    haptic: 'none asked yet',
    copied: 0,
    clipboard: 'nothing read yet',
    field: '',
    keyboardHeight: 0,
    scheme: 'not told yet',
    appState: 'not told yet',
    appStateChanges: 0,
  }),
  update: {
    PressedImpact: ($, { style }) => $.evolve({ taps: n => n + 1 }).run(
        Phone.Impact.make({ style }).pipe(Command.map(outcome => PhoneMessage.CompletedHaptic({ outcome }))),
      ),
    PressedNotify: $ =>
      $.evolve({ taps: n => n + 1 }).run(
        Phone.Notify.make({ type: 'success' }).pipe(
          Command.map(outcome => PhoneMessage.CompletedHaptic({ outcome })),
        ),
      ),
    // The phone's answer, shown as it is: a tap that is not felt is either
    // refused here (a reason) or taken and left to the phone's settings.
    CompletedHaptic: ($, { outcome }) =>
      $.evolve({ haptic: outcome._tag === 'Done' ? 'the phone took it' : `failed: ${outcome.reason}` }),
    PressedCopy: $ =>
      $.run(
        Phone.Copy.make({ text: `Copied from the playground, ${$.model.copied + 1}` }).pipe(
          Command.map(outcome => PhoneMessage.CompletedCopy({ outcome })),
        ),
      ),
    CompletedCopy: ($, { outcome }) =>
      outcome._tag === 'Done'
        ? $.evolve({ copied: n => n + 1 })
        : $.evolve({ clipboard: `copy failed: ${outcome.reason}` }),
    PressedPaste: $ => $.run(Phone.Paste.make().pipe(Command.map(pasted => PhoneMessage.CompletedPaste({ pasted })))),
    CompletedPaste: ($, { pasted }) =>
      $.evolve({ clipboard: pasted._tag === 'Text' ? pasted.text : `paste failed: ${pasted.reason}` }),
    ChangedField: ($, { text }) => $.evolve({ field: text }),
    PressedDismiss: $ => $.run(Phone.DismissKeyboard.make()),
    ChangedKeyboard: ($, { height }) => $.evolve({ keyboardHeight: Math.round(height) }),
    ChangedScheme: ($, { scheme }) => $.evolve({ scheme }),
    ChangedAppState: ($, { status }) => $.evolve({ appState: status, appStateChanges: n => n + 1 }),
  },
  subscriptions: () => [
    Phone.keyboard(frame => PhoneMessage.ChangedKeyboard({ height: frame.height })),
    Phone.colorScheme(scheme => PhoneMessage.ChangedScheme({ scheme })),
    Phone.appState(status => PhoneMessage.ChangedAppState({ status })),
  ],
  view: (h, model) => {
    const isDark = model.scheme === 'dark'
    const ink = isDark ? Look.PAPER : Look.INK
    return h.scrollView
      .style({ flex: 1, backgroundColor: isDark ? '#000000' : Look.PAPER })
      .set({ keyboardShouldPersistTaps: 'handled', contentStyle: Look.pad })
      .children(
        h.text.style({ ...Look.label, color: ink }).children('Haptic'),
        h.view.style({ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }).children(
          Look.plainButton(h, 'phone-light', 'Light tap', PhoneMessage.PressedImpact({ style: 'light' })),
          Look.plainButton(h, 'phone-heavy', 'Heavy tap', PhoneMessage.PressedImpact({ style: 'heavy' })),
          Look.plainButton(h, 'phone-success', 'Success', PhoneMessage.PressedNotify()),
        ),
        h.text.testId('phone-taps').style(Look.small).children(`Taps asked for: ${model.taps}. Last answer: ${model.haptic}`),

        h.text.style({ ...Look.label, color: ink }).children('Clipboard'),
        h.view.style({ flexDirection: 'row', gap: 8 }).children(
          Look.plainButton(h, 'phone-copy', 'Copy', PhoneMessage.PressedCopy()),
          Look.plainButton(h, 'phone-paste', 'Paste', PhoneMessage.PressedPaste()),
        ),
        h.text.testId('phone-clipboard').style(Look.small).children(
          `Copied ${model.copied} times. Read back: ${model.clipboard}`,
        ),

        h.text.style({ ...Look.label, color: ink }).children('Keyboard'),
        h.textInput
          .testId('phone-field')
          .style({ fontSize: 16, padding: 10, borderWidth: 1, borderColor: Look.LINE, borderRadius: 8, color: ink })
          .placeholder('Tap here to bring the keyboard up')
          .value(model.field)
          .on('changeText', ({ text }) => PhoneMessage.ChangedField({ text })),
        h.text.testId('phone-keyboard').style(Look.small).children(`Keyboard height: ${model.keyboardHeight} points`),
        Look.plainButton(h, 'phone-dismiss', 'Put keyboard away', PhoneMessage.PressedDismiss()),

        h.text.style({ ...Look.label, color: ink }).children('Colour scheme and app state'),
        h.text.testId('phone-scheme').style(Look.small).children(`Colour scheme: ${model.scheme}`),
        h.text.testId('phone-appstate').style(Look.small).children(
          `App state: ${model.appState} (changed ${Math.max(0, model.appStateChanges - 1)} times)`,
        ),
        // Out of the way, at the very bottom: break the app on purpose.
        CrashButtons(h, { key: 'crash' }),
      )
  },
})
