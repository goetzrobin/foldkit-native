/**
 * The composer: the text field, Send (or Stop while a reply is written), the
 * microphone and its recording bar, a voice note waiting to go, and the
 * notice line above it.
 *
 * It owns what is being written. What happens when it is sent belongs to the
 * chat screen, which hears `PressedSend` and reads the draft.
 */
import { Option, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Attachment } from '../../src/aiChat/index.js'
import { Recorder } from '../../src/device/index.js'
import { prop, style } from '../../src/foldkit/attributes.js'
import { text, textInput, view as box } from '../../src/foldkit/elements.js'
import type { Device } from '../../src/foldkit/navigation/stack.js'
import { glass, glassOptions } from '../../src/glass/index.js'
import { animated } from '../../src/motion/index.js'
import type { Context, Resources } from '../context.js'
import { dismissKeyboard, haptics } from '../effects.js'
import { fieldName } from '../focus.js'
import { Notice, Recording, clockOf } from '../model.js'
import { MOTION, type Palette, SPACE, TYPE, paletteOf } from '../theme.js'
import { StyleHairline, arrowUp, attachmentChip, cross, microphone, roundButton, stopSquare, tick } from '../ui.js'

/** The composer's text field, by the name `focus.ts` knows it by. */
export const DRAFT_FIELD = 'draft'

/** Under the pill, inside the composer: with the keyboard up, the gap between the pill and the keyboard. */
export const PILL_BOTTOM = SPACE.s

const RECORDING_LIMIT_S = 120
const RECORDING_WARN_S = 10

/** A voice note is kept as a fact: this text goes with it in place of a transcript. */
export const voiceNoteText = (seconds: number): string =>
  `(Voice note, ${clockOf(seconds)}. A transcript would go here: this demo has no speech to text.)`

// MODEL

export const Model = Schema.Struct({
  draft: Schema.String,
  attachment: Schema.Option(Attachment),
  recording: Schema.Option(Recording),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ draft: '', attachment: Option.none(), recording: Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  PressedStop: {},
  PressedMic: {},
  GotRecorderMessage: { message: Recorder.Message },
  PressedFinishRecording: {},
  PressedCancelRecording: {},
  PressedRemoveAttachment: {},
  CompletedSideEffect: {},
})
export type Message = typeof Message.Type

/** What the chat screen hears from the composer. */
export const OutMessage = defineMessageUnion({
  /** The draft changed: a notice above the composer is out of date. */
  EditedDraft: {},
  PressedSend: {},
  PressedStop: {},
  ShowedNotice: { notice: Notice },
})
export type OutMessage = typeof OutMessage.Type

// UPDATE

type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>

const done = () => Message.CompletedSideEffect()
const haptic = haptics(done)
const fromRecorder = (message: Recorder.Message) => Message.GotRecorderMessage({ message })

const notice = (model: Model, text: string): Return => ({
  model,
  outMessage: OutMessage.ShowedNotice({ notice: { text, tone: 'error' } }),
})

const onRecorder = (model: Model, message: Recorder.Message): Return => {
  switch (message._tag) {
    case 'GotPermission':
      if (message.permission === 'granted') {
        return {
          model: modifyFields(model, { recording: () => Option.some({ seconds: 0, isNearLimit: false }) }),
          commands: [
            Command.mapMessage(Recorder.Start({ maxSeconds: RECORDING_LIMIT_S, warnSeconds: RECORDING_WARN_S }), fromRecorder),
            haptic.medium(),
            dismissKeyboard(done),
          ],
        }
      }
      return notice(model, 'Microphone access is off. Turn it on in the Settings app.')
    case 'ChangedRecorderStatus':
      return {
        model: modifyFields(model, {
          recording: recording =>
            Option.map(recording, () => ({ seconds: message.status.elapsedSeconds, isNearLimit: message.status.isNearLimit })),
        }),
      }
    case 'StoppedRecording':
    case 'FinishedRecording': {
      const seconds = Math.round(message.recording.durationMs / 1000)
      return {
        model: modifyFields(model, {
          recording: () => Option.none(),
          attachment: () =>
            Option.some({ name: `Voice note ${clockOf(seconds)}`, mediaType: 'audio/mp4', sizeBytes: message.recording.sizeBytes }),
          // In place of a transcript: no speech to text here. Edit it or send it.
          draft: draft => (draft.trim() === '' ? voiceNoteText(seconds) : draft),
        }),
        commands: [haptic.light()],
      }
    }
    case 'CanceledRecording':
      return { model: modifyFields(model, { recording: () => Option.none() }) }
    case 'FailedPermission':
    case 'FailedStartRecording':
    case 'FailedRecording':
      return notice(modifyFields(model, { recording: () => Option.none() }), `Could not record: ${message.reason}`)
    default:
      return { model }
  }
}

export const update = (model: Model, message: Message): Return =>
  Message.match<Return>(message, {
    ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text }), outMessage: OutMessage.EditedDraft() }),
    PressedSend: () => ({ model, outMessage: OutMessage.PressedSend() }),
    PressedStop: () => ({ model, outMessage: OutMessage.PressedStop() }),
    PressedMic: () => ({ model, commands: [Command.mapMessage(Recorder.RequestPermission(), fromRecorder)] }),
    GotRecorderMessage: ({ message: recorder }) => onRecorder(model, recorder),
    PressedFinishRecording: () => ({ model, commands: [Command.mapMessage(Recorder.Stop(), fromRecorder)] }),
    PressedCancelRecording: () => ({ model, commands: [Command.mapMessage(Recorder.Cancel(), fromRecorder)] }),
    PressedRemoveAttachment: () => ({
      model: modifyFields(model, {
        attachment: () => Option.none(),
        draft: draft => (draft.startsWith('(Voice note,') ? '' : draft),
      }),
    }),
    CompletedSideEffect: () => ({ model }),
  })

/** The draft is gone: it was sent. */
export const sent = (model: Model): Model =>
  modifyFields(model, { draft: () => '', attachment: () => Option.none() })

/** A message that could not be sent comes back into an empty field, so nothing is lost. */
export const restore = (model: Model, text: string): Model =>
  modifyFields(model, { draft: draft => (draft.trim() === '' ? text : draft) })

/** The recording's clock runs only while recording. */
export const isRecording = (model: Model): boolean => Option.isSome(model.recording)

// VIEW

export type ViewInputs = Context &
  Readonly<{
    /** A line above the composer: a refused message, a copy. Owned by the chat screen. */
    notice: Option.Option<Notice>
    /** A reply is being written: Send becomes Stop. */
    isStreaming: boolean
  }>

/** Whether Send can be pressed now. */
export const canSend = (model: Model, inputs: Pick<ViewInputs, 'shared' | 'isStreaming'>): boolean =>
  inputs.shared.isOnline &&
  !inputs.isStreaming &&
  Option.isNone(model.recording) &&
  (model.draft.trim() !== '' || Option.isSome(model.attachment))

/** Send, Stop and the microphone take each other's place with a quick fade. */
const swapIn = (button: Html): Html =>
  animated({ enter: { from: { opacity: 0 }, duration: MOTION.sendStop, easing: 'easeOut' } }, button)

const sendOrStopButton = (h: HtmlBuilder<Message>, model: Model, inputs: ViewInputs, palette: Palette): Html => {
  if (inputs.isStreaming) {
    return roundButton(h, { id: 'stop', label: 'Stop the reply', fill: palette.ink, onPress: Message.PressedStop() }, stopSquare(palette.bg))
  }
  const isEmpty = model.draft.trim() === '' && Option.isNone(model.attachment)
  if (isEmpty && Option.isNone(model.recording)) {
    return roundButton(
      h,
      { id: 'mic', label: 'Record a voice note', fill: 'transparent', onPress: inputs.shared.isOnline ? Message.PressedMic() : undefined },
      microphone(palette.ink2),
    )
  }
  const isOn = canSend(model, inputs)
  return roundButton(
    h,
    { id: 'send', label: 'Send', fill: isOn ? palette.accent : palette.surface2, onPress: isOn ? Message.PressedSend() : undefined },
    arrowUp(isOn ? palette.onAccent : palette.ink3),
  )
}

const recordingBar = (h: HtmlBuilder<Message>, palette: Palette, seconds: number, isNearLimit: boolean): Html =>
  box(
    [prop('testID', 'recording'), style({ flexDirection: 'row', alignItems: 'center', gap: SPACE.m, minHeight: 40, paddingLeft: SPACE.s })],
    [
      roundButton(h, { id: 'cancel-recording', label: 'Throw the recording away', fill: palette.surface2, size: 28, onPress: Message.PressedCancelRecording() }, cross(palette.ink2)),
      box([style({ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger })], []),
      text(
        [prop('testID', 'recording-time'), style({ ...TYPE.meta, color: isNearLimit ? palette.danger : palette.ink, flex: 1 })],
        [`Recording ${clockOf(seconds)}`],
      ),
      roundButton(h, { id: 'finish-recording', label: 'Done recording', fill: palette.ink, onPress: Message.PressedFinishRecording() }, tick(palette.bg)),
    ],
  )

const field = (h: HtmlBuilder<Message>, device: Device, model: Model, inputs: ViewInputs, palette: Palette): Html =>
  textInput(
    [
      h.Key('draft'),
      prop('testID', 'draft'),
      fieldName(DRAFT_FIELD),
      h.Attribute('value', model.draft),
      h.Placeholder(inputs.shared.isOnline ? 'Ask anything' : 'Offline'),
      prop('placeholderTextColor', palette.ink3),
      prop('selectionColor', palette.accent),
      prop('cursorColor', palette.accent),
      prop('multiline', true),
      prop('editable', true),
      // No `autoFocus`: a new chat focuses this field by a Command once its
      // push has finished, so the keyboard comes up once. See `focus.ts`.
      prop('keyboardAppearance', inputs.shared.scheme),
      h.OnInput(words => Message.ChangedDraft({ text: words })),
      style({
        flex: 1,
        minHeight: 40,
        maxHeight: 5 * TYPE.message.lineHeight + 18,
        paddingTop: device.platform === 'ios' ? 10 : 8,
        paddingBottom: device.platform === 'ios' ? 10 : 8,
        paddingHorizontal: SPACE.m,
        ...TYPE.message,
        color: palette.ink,
      }),
    ],
    [],
  )

export const view_ = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const palette = paletteOf(inputs.shared.scheme)
  const notice = Option.match(inputs.notice, {
    onNone: () => [],
    onSome: each => [
      text(
        [prop('testID', 'notice'), style({ ...TYPE.caption, color: each.tone === 'error' ? palette.danger : palette.ink2, marginHorizontal: SPACE.xl, marginBottom: 6 })],
        [each.text],
      ),
    ],
  })
  const attachment = Option.match(model.attachment, {
    onNone: () => [],
    onSome: each => [
      box(
        [style({ paddingHorizontal: 6, paddingTop: 4 })],
        [
          attachmentChip(palette, each.name, [
            roundButton(h, { id: 'remove-attachment', label: 'Remove the voice note', fill: 'transparent', size: 20, onPress: Message.PressedRemoveAttachment() }, cross(palette.ink3)),
          ]),
        ],
      ),
    ],
  })
  const pill = glass(
    [
      glassOptions({ isInteractive: false, fallbackStyle: { backgroundColor: palette.glassFallback, borderWidth: StyleHairline, borderColor: palette.line } }),
      prop('testID', 'composer'),
      style({ marginHorizontal: SPACE.m, marginBottom: PILL_BOTTOM, borderRadius: 26, padding: 6, gap: 4 }),
    ],
    [
      ...attachment,
      Option.match(model.recording, {
        onSome: each => recordingBar(h, palette, each.seconds, each.isNearLimit),
        onNone: () =>
          box(
            [style({ flexDirection: 'row', alignItems: 'flex-end', gap: 6 })],
            [field(h, inputs.device, model, inputs, palette), box([style({ paddingBottom: 4, paddingRight: 2 })], [swapIn(sendOrStopButton(h, model, inputs, palette))])],
          ),
      }),
    ],
  )
  return box([style({ paddingTop: SPACE.s })], [...notice, pill])
}

export const view = Submodel.defineView<Model, Message, ViewInputs>(view_)
