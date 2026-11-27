/**
 * The composer: the text field and the round buttons beside it, at the
 * bottom of a chat, on glass.
 *
 * It owns what is being written: the draft, a voice note waiting to go, a
 * recording, and whether the phone is listening. When the person sends, it
 * empties itself and tells the chat screen the text and the voice note
 * (`Submitted`). It knows nothing about the server.
 *
 * The buttons, right of the field:
 *
 * - Empty field: two buttons. The sound wave records a voice note. The
 *   microphone listens and writes what it hears into the field.
 * - Something to send: the microphone, to add to it by voice, and Send.
 *   Send is grey and off while a message is on its way or the phone is
 *   offline.
 * - The phone is listening: the microphone alone, filled, to stop it.
 * - A reply is being written: Stop.
 *
 * Listening (speech recognition). A press on the microphone asks the phone
 * for leave, then starts. The words appear in the field as they are spoken,
 * after whatever was there before. A second press stops. If the phone
 * refuses or fails, a short notice says why and the field is as it was
 * before the press. Typing while the phone listens stops it, so the two do
 * not write over each other.
 *
 * A voice note. The sound wave asks for the microphone, then records, with
 * a clock, a way to throw the recording away and a way to finish. A finished
 * note waits above the field as a chip, with a button to hear it and one to
 * remove it. Hearing it goes through the app's one player (`playback.ts`),
 * so the mini player shows it too, and starting it stops any other note. The phone is then asked to read the note's words from the file.
 * If it can, they go into the field. If it cannot, the field keeps a line
 * that says a voice note is attached.
 *
 * The keyboard: the field has no `autoFocus`. The chat screen asks for the
 * caret once the push is over, by raising `focusRequest`. A ref only
 * resolves inside the component that owns the element, so the composer runs
 * the focus itself. The same way, the chat screen hands back the text of a
 * message the server refused (`restore`).
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Schema, Stream } from 'effect'

import { Attachment } from '../../../native/src/host/aiChat/wire.js'
import { Motion, Native, NativeCommand, NativeViews, Phone } from '../../src/index.js'
import { arrowUp, cross, microphone, playIcon, soundWave, stopSquare, tick } from '../icons.js'
import { clockOf } from '../list.js'
import { NOTHING_PLAYING, PlayerEvent, PlayerState, PlayerStep, SendToPlayer, heardPlayer, isPlaying, noteOf, sender } from '../playback.js'
import { HAIRLINE, MOTION, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { attachmentChip, roundButton } from '../ui.js'

export const ComposerProps = Schema.Struct({
  scheme: Scheme,
  platform: Schema.String,
  /** A message is on its way to the server. Send is off. */
  isSending: Schema.Boolean,
  /** A reply is being written. The button is Stop. */
  isReplying: Schema.Boolean,
  isOnline: Schema.Boolean,
  /** Raised by one each time the field should take the caret. 0: never asked. */
  focusRequest: Schema.Number,
  /** Text to put back into an empty field: a message the server refused. A new `id` each time. */
  restore: Schema.NullOr(Schema.Struct({ id: Schema.Number, text: Schema.String })),
})

export const ComposerMessage = UiSchema.TaggedEnum({
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  PressedStop: {},
  RequestedFocus: {},
  RequestedRestore: {},
  // Listening
  PressedMic: {},
  GotSpeechAccess: { access: Phone.Access },
  StartedListening: { outcome: Phone.Outcome },
  HeardSpeech: { event: Phone.SpeechEvent },
  // A voice note
  PressedRecord: {},
  GotMicrophoneAccess: { access: Phone.Access },
  StartedRecording: { outcome: Phone.Outcome },
  GotRecorderEvent: { event: Phone.RecorderEvent },
  PressedFinishRecording: {},
  StoppedRecording: { result: Phone.Recorded },
  PressedCancelRecording: {},
  PressedRemoveNote: {},
  PressedPlayNote: {},
  /** The app's player took a step. */
  HeardPlayer: { step: PlayerStep },
  Done: {},
})

export const ComposerEvents = UiSchema.TaggedEnum({
  Submitted: { text: Schema.String, attachments: Schema.Array(Attachment) },
  PressedStop: {},
  /** The draft changed: a notice above the composer is out of date. */
  EditedDraft: {},
  /** A line for the chat screen to show above the composer. */
  Noticed: { text: Schema.String },
})

const Note = Schema.Struct({
  name: Schema.String,
  uri: Schema.String,
  sizeBytes: Schema.Number,
  seconds: Schema.Number,
})

const ComposerModel = Schema.Struct({
  draft: Schema.String,
  /** A finished voice note, waiting to go with the next message. */
  note: Schema.NullOr(Note),
  /** The app's player, as last heard. It says whether the waiting note is the one playing. */
  player: PlayerState,
  /** How many events this part has sent the player. The next one's id is made from it. */
  sent: Schema.Number,
  /** The recorder's clock, while it records. */
  recording: Schema.NullOr(Schema.Struct({ seconds: Schema.Number, isNearLimit: Schema.Boolean })),
  /**
   * Speech recognition. `asking`: the phone is being asked for leave.
   * `on`: it listens. What it reads: the microphone, or the voice note's file.
   */
  listening: Schema.Literals(['off', 'asking', 'on']),
  listensTo: Schema.Literals(['microphone', 'note']),
  /** The draft as it was when listening started. The words heard go after it. */
  draftBefore: Schema.String,
  /** What this part last wrote into the field for a voice note. Typed over, it is the person's text. */
  noteText: Schema.String,
})
type ComposerModel = typeof ComposerModel.Type

/** The composer's text field. */
export const DraftField = Native.ref('draft')
/** The field's name on the phone. The keyboard's drag finds the field by it. */
export const DRAFT_FIELD_ID = 'effect-chat-draft'

export const BUTTON_SIZE = 32
/** Under the pill, inside the composer: with the keyboard up, the gap between the pill and the keyboard. */
export const PILL_BOTTOM = SPACE.s

const RECORDING_LIMIT_S = 120
const RECORDING_WARN_S = 10

/** In the field for a voice note whose words the phone could not read. */
export const voiceNoteText = (seconds: number): string => `(Voice note, ${clockOf(seconds)})`

/** One Message each time the chat screen raises `focusRequest`. */
const focusRequests = (request: number) =>
  Subscription.make('chat/composer/focus', request, () => Stream.succeed(ComposerMessage.RequestedFocus()))

/** One Message each time the chat screen hands text back. */
const restoreRequests = (id: number) =>
  Subscription.make('chat/composer/restore', id, () => Stream.succeed(ComposerMessage.RequestedRestore()))

const done = Command.as(ComposerMessage.Done())
/** The app's player is loading or playing this note. */
const isSounding = (player: PlayerState, uri: string): boolean =>
  isPlaying(player, uri) || (PlayerState.$is('Loading')(player) && player.note.uri === uri)

/** Tells the app's player to stop. `count` makes the id of this part's event. */
const stopPlayer = (count: number) =>
  SendToPlayer.make({ event: PlayerEvent.Stop({ by: sender('composer', `note#${count}`) }) }).pipe(done)
const impact = (style: 'light' | 'medium') => Phone.Impact.make({ style }).pipe(done)

/** What was there before, then what was heard. */
const withHeard = (before: string, heard: string): string =>
  before.trim() === '' ? heard : heard === '' ? before : `${before.replace(/\s+$/, '')} ${heard}`

/** A finished recording becomes the note that waits above the field, with its line in an empty field. */
const noteFields = (model: ComposerModel, recording: typeof Phone.Device.Recorder.Recording.Type) => {
  const seconds = Math.round(recording.durationMs / 1000)
  const isEmpty = model.draft.trim() === ''
  const line = voiceNoteText(seconds)
  return {
    recording: null,
    note: { name: `Voice note ${clockOf(seconds)}`, uri: recording.uri, sizeBytes: recording.sizeBytes, seconds },
    draft: isEmpty ? line : model.draft,
    noteText: isEmpty ? line : '',
    // The phone is asked to read the note's words from its file.
    listening: 'asking' as const,
    listensTo: 'note' as const,
  }
}

const askToReadNote = Phone.RequestSpeech.make({}).pipe(Command.map(access => ComposerMessage.GotSpeechAccess({ access })))

const ACCESS_OFF: Readonly<Record<'microphone' | 'speech', string>> = {
  microphone: 'Microphone access is off. Turn it on in the Settings app.',
  speech: 'Speech recognition is off. Turn it on in the Settings app.',
}

export const Composer = Native.component({
  name: 'Composer',
  props: ComposerProps,
  model: ComposerModel,
  message: ComposerMessage,
  events: ComposerEvents,
}).make({
  init: () => ({
    draft: '',
    note: null,
    player: NOTHING_PLAYING,
    sent: 0,
    recording: null,
    listening: 'off' as const,
    listensTo: 'microphone' as const,
    draftBefore: '',
    noteText: '',
  }),
  update: {
    ChangedDraft: ($, { text }) => {
      if (text === $.model.draft) return $.model
      const next = $.evolve({ draft: text }).emit(ComposerEvents.EditedDraft())
      // Typing while the phone listens: the person's text wins, and listening ends.
      return $.model.listening === 'off'
        ? next
        : $.evolve({ draft: text, listening: 'off' as const })
            .emit(ComposerEvents.EditedDraft())
            .run(Phone.AbortListening.make({}).pipe(done))
    },
    PressedSend: $ => {
      const text = $.model.draft.trim()
      const note = $.model.note
      if ((text === '' && note === null) || $.props.isSending || $.props.isReplying || !$.props.isOnline) return $.model
      const attachments = note === null ? [] : [{ name: note.name, mediaType: 'audio/mp4', sizeBytes: note.sizeBytes, uri: note.uri }]
      const holdsNote = note !== null && noteOf($.model.player)?.uri === note.uri
      const next = $.evolve({
        draft: '',
        note: null,
        noteText: '',
        listening: 'off' as const,
        sent: holdsNote ? $.model.sent + 1 : $.model.sent,
      }).emit(ComposerEvents.Submitted({ text: text === '' && note !== null ? voiceNoteText(note.seconds) : text, attachments }))
      // The note has gone with the message: the player lets it go.
      const quiet = holdsNote ? next.run(stopPlayer($.model.sent + 1)) : next
      return $.model.listening === 'off' ? quiet : quiet.run(Phone.AbortListening.make({}).pipe(done))
    },
    PressedStop: $ => ($.props.isReplying ? $.emit(ComposerEvents.PressedStop()) : $.model),
    RequestedFocus: $ => $.run(NativeCommand.focus(DraftField).pipe(done)),
    // A refused message goes back into an empty field, so nothing is lost. Text typed since then stays.
    RequestedRestore: $ => {
      const restore = $.props.restore
      return restore === null || $.model.draft.trim() !== '' ? $.model : $.evolve({ draft: restore.text })
    },

    // LISTENING
    PressedMic: $ => {
      if ($.model.listening === 'on') return $.run(Phone.StopListening.make({}).pipe(done))
      if ($.model.listening === 'asking' || $.model.recording !== null) return $.model
      return $.evolve({ listening: 'asking' as const, listensTo: 'microphone' as const, draftBefore: $.model.draft }).run(
        Phone.RequestSpeech.make({}).pipe(Command.map(access => ComposerMessage.GotSpeechAccess({ access }))),
      )
    },
    GotSpeechAccess: ($, { access }) => {
      if ($.model.listening !== 'asking') return $.model
      const isForNote = $.model.listensTo === 'note'
      if (access.access !== 'granted') {
        const off = $.evolve({ listening: 'off' as const })
        // A voice note keeps its line in the field. Nothing more is said.
        return isForNote
          ? off
          : off.emit(
              ComposerEvents.Noticed({
                text: access.access === 'failed' ? `Could not listen: ${access.reason}` : ACCESS_OFF.speech,
              }),
            )
      }
      const next = $.evolve({ listening: 'on' as const }).run(
        Phone.StartListening.make({ lang: '', audioUri: isForNote ? ($.model.note?.uri ?? null) : null }).pipe(
          Command.map(outcome => ComposerMessage.StartedListening({ outcome })),
        ),
      )
      return isForNote ? next : next.run(impact('light'))
    },
    StartedListening: ($, { outcome }) => {
      if (outcome._tag === 'Done' || $.model.listening === 'off') return $.model
      const off = $.evolve({ listening: 'off' as const })
      return $.model.listensTo === 'note'
        ? off
        : $.evolve({ listening: 'off' as const, draft: $.model.draftBefore }).emit(
            ComposerEvents.Noticed({ text: `Could not listen: ${outcome.reason}` }),
          )
    },
    HeardSpeech: ($, { event }) => {
      const model = $.model
      if (model.listening !== 'on') return model
      const isForNote = model.listensTo === 'note'
      switch (event._tag) {
        case 'Started':
          return model
        case 'Result': {
          if (event.text.trim() === '') return model
          if (!isForNote) return $.evolve({ draft: withHeard(model.draftBefore, event.text) })
          // The note's words take the place of its line, unless the person has typed over it.
          return model.draft === model.noteText ? $.evolve({ draft: event.text, noteText: event.text }) : model
        }
        case 'Ended':
          return $.evolve({ listening: 'off' as const })
        case 'Failed': {
          const off = $.evolve({ listening: 'off' as const })
          // `aborted` is this part's own doing.
          if (isForNote || event.code === 'aborted') return off
          return $.evolve({ listening: 'off' as const, draft: model.draftBefore }).emit(
            ComposerEvents.Noticed({
              text:
                event.code === 'no-speech'
                  ? 'Nothing was heard.'
                  : event.code === 'not-allowed'
                    ? ACCESS_OFF.speech
                    : `Could not listen: ${event.reason}`,
            }),
          )
        }
      }
    },

    // A VOICE NOTE
    PressedRecord: $ =>
      $.model.recording !== null || $.model.listening !== 'off' || !$.props.isOnline
        ? $.model
        : $.run(
            Phone.RequestMicrophone.make({}).pipe(Command.map(access => ComposerMessage.GotMicrophoneAccess({ access }))),
          ),
    GotMicrophoneAccess: ($, { access }) =>
      access.access === 'granted'
        ? $.evolve({ recording: { seconds: 0, isNearLimit: false } })
            .run(
              Phone.StartRecording.make({ maxSeconds: RECORDING_LIMIT_S, warnSeconds: RECORDING_WARN_S }).pipe(
                Command.map(outcome => ComposerMessage.StartedRecording({ outcome })),
              ),
            )
            .run(impact('medium'))
            .run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop))
        : $.emit(
            ComposerEvents.Noticed({
              text: access.access === 'failed' ? `Could not record: ${access.reason}` : ACCESS_OFF.microphone,
            }),
          ),
    StartedRecording: ($, { outcome }) =>
      outcome._tag === 'Done'
        ? $.model
        : $.evolve({ recording: null }).emit(ComposerEvents.Noticed({ text: `Could not record: ${outcome.reason}` })),
    GotRecorderEvent: ($, { event }) => {
      if ($.model.recording === null) return $.model
      switch (event._tag) {
        case 'Status':
          return $.evolve({ recording: { seconds: event.status.elapsedSeconds, isNearLimit: event.status.isNearLimit } })
        case 'Finished':
          // It reached its longest length and stopped by itself.
          return $.evolve(noteFields($.model, event.recording)).run(impact('light')).run(askToReadNote)
        case 'Failed':
          return $.evolve({ recording: null }).emit(ComposerEvents.Noticed({ text: `Could not record: ${event.reason}` }))
      }
    },
    PressedFinishRecording: $ =>
      $.model.recording === null
        ? $.model
        : $.run(Phone.StopRecording.make({}).pipe(Command.map(result => ComposerMessage.StoppedRecording({ result })))),
    StoppedRecording: ($, { result }) => {
      if ($.model.recording === null) return $.model
      if (result._tag === 'Failed') {
        return $.evolve({ recording: null }).emit(ComposerEvents.Noticed({ text: `Could not record: ${result.reason}` }))
      }
      return $.evolve(noteFields($.model, result.recording)).run(impact('light')).run(askToReadNote)
    },
    PressedCancelRecording: $ =>
      $.model.recording === null ? $.model : $.evolve({ recording: null }).run(Phone.CancelRecording.make({}).pipe(done)),
    PressedRemoveNote: $ => {
      const model = $.model
      if (model.note === null) return model
      const wasReading = model.listening !== 'off' && model.listensTo === 'note'
      const holdsNote = noteOf(model.player)?.uri === model.note.uri
      const next = $.evolve({
        note: null,
        draft: model.draft === model.noteText ? '' : model.draft,
        noteText: '',
        listening: wasReading ? ('off' as const) : model.listening,
        sent: holdsNote ? model.sent + 1 : model.sent,
      })
      const quiet = holdsNote ? next.run(stopPlayer(model.sent + 1)) : next
      return wasReading ? quiet.run(Phone.AbortListening.make({}).pipe(done)) : quiet
    },
    PressedPlayNote: $ => {
      const note = $.model.note
      if (note === null) return $.model
      const by = sender('composer', `note#${$.model.sent + 1}`)
      // The player's state decides: this note is loading or playing, so stop it. Otherwise play it from the start.
      const event =
        isSounding($.model.player, note.uri)
          ? PlayerEvent.Stop({ by })
          : PlayerEvent.Play({ note: { uri: note.uri, label: note.name }, by })
      return $.evolve({ sent: count => count + 1 }).run(SendToPlayer.make({ event }).pipe(done))
    },
    HeardPlayer: ($, { step }) => $.evolve({ player: step.after }),
    Done: $ => $.model,
  },
  subscriptions: ({ props, model }) => [
    props.focusRequest > 0 && focusRequests(props.focusRequest),
    props.restore !== null && restoreRequests(props.restore.id),
    // From before the phone is asked to start, so its first word is not missed.
    model.listening !== 'off' && Phone.speech(event => ComposerMessage.HeardSpeech({ event })),
    model.recording !== null && Phone.recorder(event => ComposerMessage.GotRecorderEvent({ event })),
    model.note !== null && heardPlayer(step => ComposerMessage.HeardPlayer({ step }), { positions: false }),
  ],
  view: (h, model) => {
    const { scheme, platform, isSending, isReplying, isOnline } = h.props
    const palette = paletteOf(scheme)
    const isListening = model.listening !== 'off' && model.listensTo === 'microphone'
    const hasSomething = model.draft.trim() !== '' || model.note !== null
    const canSend = hasSomething && !isSending && !isReplying && isOnline

    // Send and Stop take each other's place with a quick fade: the one that comes fades in.
    const swapIn = (id: string, button: Native.NoTextContent<typeof ComposerMessage.Type>) =>
      Motion.animate(h.view.key(`swap-${id}`).testId(`swap-${id}`), {
        from: { opacity: 0 },
        to: { opacity: 1 },
        ms: MOTION.sendStop,
      }).children(button)

    const buttons = isReplying
      ? [
          swapIn(
            'stop',
            roundButton(h, { id: 'stop', label: 'Stop the reply', fill: palette.ink, message: ComposerMessage.PressedStop() }, stopSquare(h, palette.bg)),
          ),
        ]
      : isListening
        ? [
            roundButton(
              h,
              { id: 'mic', label: 'Stop listening', fill: palette.ink, message: ComposerMessage.PressedMic() },
              microphone(h, palette.bg),
            ),
          ]
        : [
            // Nothing to send yet: a voice note can be recorded.
            hasSomething
              ? null
              : roundButton(
                  h,
                  {
                    id: 'record',
                    label: 'Record a voice note',
                    fill: 'transparent',
                    message: isOnline ? ComposerMessage.PressedRecord() : undefined,
                  },
                  soundWave(h, palette.ink2),
                ),
            roundButton(
              h,
              { id: 'mic', label: 'Speak your message', fill: 'transparent', message: ComposerMessage.PressedMic() },
              microphone(h, palette.ink2),
            ),
            hasSomething
              ? swapIn(
                  'send',
                  roundButton(
                    h,
                    {
                      id: 'send',
                      label: 'Send',
                      fill: canSend ? palette.accent : palette.surface2,
                      message: canSend ? ComposerMessage.PressedSend() : undefined,
                    },
                    arrowUp(h, canSend ? palette.onAccent : palette.ink3),
                  ),
                )
              : null,
          ]

    const recording = model.recording
    const note = model.note
    const isPlayingNote = note !== null && isSounding(model.player, note.uri)
    return h.view.style({ paddingTop: SPACE.s }).children(
      NativeViews.glass(h, {
        isInteractive: false,
        style: { marginHorizontal: SPACE.m, marginBottom: PILL_BOTTOM, borderRadius: 26, padding: 6, gap: 4 },
        fallbackStyle: { backgroundColor: palette.glassFallback, borderWidth: HAIRLINE, borderColor: palette.line },
      })
        .prop('testID', 'composer')
        .children(
          note === null
            ? null
            : h.view
                .key('note')
                .testId('voice-note')
                .style({ paddingHorizontal: 6, paddingTop: 4 })
                .children(
                  attachmentChip(h, palette, note.name, [
                    roundButton(
                      h,
                      {
                        id: 'play-note',
                        label: isPlayingNote ? 'Stop playing the voice note' : 'Play the voice note',
                        fill: 'transparent',
                        size: 20,
                        message: ComposerMessage.PressedPlayNote(),
                      },
                      isPlayingNote ? stopSquare(h, palette.ink2) : playIcon(h, palette.ink2),
                    ),
                    roundButton(
                      h,
                      { id: 'remove-note', label: 'Remove the voice note', fill: 'transparent', size: 20, message: ComposerMessage.PressedRemoveNote() },
                      cross(h, palette.ink3),
                    ),
                  ]),
                ),
          recording !== null
            ? h.view
                .key('recording')
                .testId('recording')
                .style({ flexDirection: 'row', alignItems: 'center', gap: SPACE.m, minHeight: 40, paddingLeft: SPACE.s })
                .children(
                  roundButton(
                    h,
                    { id: 'cancel-recording', label: 'Throw the recording away', fill: palette.surface2, size: 28, message: ComposerMessage.PressedCancelRecording() },
                    cross(h, palette.ink2),
                  ),
                  h.view.style({ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger }),
                  h.text
                    .testId('recording-time')
                    .style({ ...TYPE.meta, color: recording.isNearLimit ? palette.danger : palette.ink, flex: 1 })
                    .children(`Recording ${clockOf(recording.seconds)}`),
                  roundButton(
                    h,
                    { id: 'finish-recording', label: 'Done recording', fill: palette.ink, message: ComposerMessage.PressedFinishRecording() },
                    tick(h, palette.bg),
                  ),
                )
            : h.view
                .key('row')
                .style({ flexDirection: 'row', alignItems: 'flex-end', gap: 6 })
                .children(
                  h.textInput
                    .testId('draft')
                    .ref(DraftField)
                    .style({
                      ...TYPE.message,
                      flex: 1,
                      minHeight: 40,
                      maxHeight: 5 * TYPE.message.lineHeight + 18,
                      paddingHorizontal: SPACE.m,
                      paddingTop: platform === 'ios' ? 10 : 8,
                      paddingBottom: platform === 'ios' ? 10 : 8,
                      color: palette.ink,
                    })
                    .set({
                      multiline: true,
                      placeholderTextColor: palette.ink3,
                      selectionColor: palette.accent,
                      keyboardAppearance: scheme,
                    })
                    .prop('nativeID', DRAFT_FIELD_ID)
                    .placeholder(isListening ? 'Listening' : isOnline ? 'Ask anything' : 'Offline')
                    .value(model.draft)
                    .on('changeText', ({ text }) => ComposerMessage.ChangedDraft({ text })),
                  h.view.style({ flexDirection: 'row', gap: 6, paddingBottom: 4, paddingRight: 2 }).children(...buttons),
                ),
        ),
    )
  },
})
