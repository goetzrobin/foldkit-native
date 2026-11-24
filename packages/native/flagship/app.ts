/**
 * Fold Chat: the program. Model and Messages are in `model.ts`, the screens
 * in `listScreen.ts`, `chatScreen.ts` and `sheets.ts`. This file holds what
 * happens: `update`, the Commands, and the Subscriptions.
 *
 * The replies come from the pretend AI server inside the app
 * (src/aiChat), reached through Effect's RPC client as lines of JSON. The
 * reconnect and background rules are the ones `test/demos/aiBackend.ts`
 * established: on a lost connection, try again after 0.25, 0.5, 1, 2 and 4
 * seconds, then offer a button; on return to the app (or to the network)
 * with a reply still being written, resume it at once.
 */
import { Duration, Effect, Layer, Option, Schema, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import {
  type AiServer,
  type Conversation,
  type Disk,
  type InProcessLink,
  LiveTurnOps,
  MAX_RECONNECTS,
  PendingOps,
  SPEEDS,
  diskFromFiles,
  layerInProcess,
  makeAiChat,
  makeAiServer,
  makeInProcessLink,
  memoryDisk,
  reconnectDelayMs,
  type LiveTurn,
  type TurnUpdate,
} from '../src/aiChat/index.js'
import {
  Clipboard,
  ColorScheme,
  Haptics,
  Keyboard,
  Linking,
  Native,
  Network,
  Recorder,
  Share,
  Storage,
  type Services,
} from '../src/device/index.js'
import { scrollListToEnd } from '../src/list/index.js'
import { ActionSheet } from '../src/menus/index.js'
import { type Device, stack } from '../src/foldkit/navigation/stack.js'
import { type ServerState, focusEntry, watchAtom } from '../src/serverState/index.js'
import { closeAllSwipes } from '../src/swipe/index.js'
import { closeNativeSwipes } from '../src/swipeNative/index.js'
import { Appearance } from './appearance.js'
import { DRAFT_FIELD, TRANSCRIPT_ID, chatScreen, chatTitle, voiceNoteText } from './chatScreen.js'
import { focusField } from './focus.js'
import { listScreen } from './listScreen.js'
import {
  DEFAULT_SETTINGS,
  Message,
  Model,
  Settings,
  chatRows,
  clockOf,
  ignore,
  lastQuestionKey,
  textOf,
} from './model.js'
import { sheetScreens } from './sheets.js'

export type ChatAppEnv = Readonly<{ device: Device }>

export type ChatAppOptions = Readonly<{
  /** The pretend server. A test passes its own to set its dials and read its log. */
  server?: AiServer
  /** Where the server keeps conversations when no server is given. */
  disk?: Disk
  link?: InProcessLink
  /** Added under the client and the server. A test passes a `TestClock`. */
  extra?: Layer.Layer<never>
  /** The window in which text pieces become one Message. Default 32 ms. */
  batchMs?: number
  /** The clock for "Today" and "Yesterday". Default `Date.now`. */
  now?: () => number
}>

/** What the program needs from outside: the phone, the action sheet, the theme. */
export type ChatAppResources = Services | ActionSheet.ActionSheet | Appearance

const SETTINGS_KEY = 'fold-chat.settings'
const NOTICE_MS = 2200
const RECORDING_LIMIT_S = 120
const RECORDING_WARN_S = 10

let sharedDisk: Disk | undefined

/**
 * On a phone: files in the app's documents, which survive a restart. In a
 * build without the file module: memory, kept while the app runs.
 */
export const defaultDisk = (): Disk => {
  if (sharedDisk !== undefined) return sharedDisk
  const module = Native.fileSystemFromGlobal()
  try {
    sharedDisk = module === null ? memoryDisk().disk : diskFromFiles(Native.filesFrom(module, 'fold-chat'))
  } catch {
    sharedDisk = memoryDisk().disk
  }
  return sharedDisk
}

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Settings))

export const makeChatApp = (
  container: HTMLElement,
  env: ChatAppEnv,
  resources: Layer.Layer<ChatAppResources>,
  options: ChatAppOptions = {},
) => {
  const server = options.server ?? makeAiServer({ disk: options.disk ?? defaultDisk() })
  const link = options.link ?? makeInProcessLink()
  const chat = makeAiChat({
    transport: layerInProcess(server, link),
    ...(options.extra === undefined ? {} : { extra: options.extra }),
  })
  const now = options.now ?? (() => Date.now())

  type Resources = ServerState | ChatAppResources
  type Return = Update.Return<Model, Message, Resources>

  // COMMANDS

  const failed = (action: string) => (reason: string) => Message.FailedWrite({ action, reason })

  const Create = Command.define('ChatCreate', {
    messages: [Message.CreatedConversation, Message.FailedWrite],
    execute: chat.create(undefined, summary => Message.CreatedConversation({ id: summary.id }), failed('start the chat')),
  })

  const Send = Command.define('ChatSend', {
    args: {
      conversationId: Schema.String,
      text: Schema.String,
      clientMessageId: Schema.String,
      attachments: Schema.Array(Schema.Struct({ name: Schema.String, mediaType: Schema.String, sizeBytes: Schema.Number })),
    },
    messages: [Message.StartedTurn, Message.FailedSend],
    execute: args =>
      Effect.map(chat.send(args), answer =>
        answer._tag === 'Started'
          ? Message.StartedTurn({ clientMessageId: args.clientMessageId, started: answer.started })
          : Message.FailedSend({ clientMessageId: args.clientMessageId, text: args.text, reason: answer.error.reason }),
      ),
  })

  const Regenerate = Command.define('ChatRegenerate', {
    args: { conversationId: Schema.String },
    messages: [Message.StartedRegenerate, Message.FailedWrite],
    execute: ({ conversationId }) =>
      Effect.map(chat.regenerate(conversationId), answer =>
        answer._tag === 'Started'
          ? Message.StartedRegenerate({ started: answer.started })
          : Message.FailedWrite({ action: 'write the reply again', reason: answer.error.reason }),
      ),
  })

  const Stop = Command.define('ChatStop', {
    args: { turnId: Schema.String },
    messages: [Message.StoppedTurn, Message.FailedWrite],
    execute: ({ turnId }) => chat.stop(turnId, () => Message.StoppedTurn(), failed('stop the reply')),
  })

  const Resume = Command.define('ChatResume', {
    args: { turnId: Schema.String, delayMs: Schema.Number },
    messages: [Message.Resumed],
    execute: ({ turnId, delayMs }) => chat.resume(turnId, delayMs, () => Message.Resumed({ turnId })),
  })

  const Rename = Command.define('ChatRename', {
    args: { id: Schema.String, title: Schema.String },
    messages: [Message.RenamedConversation, Message.FailedWrite],
    execute: ({ id, title }) => chat.rename(id, title, () => Message.RenamedConversation(), failed('rename the chat')),
  })

  const Delete = Command.define('ChatDelete', {
    args: { id: Schema.String },
    messages: [Message.DeletedConversation, Message.FailedWrite],
    execute: ({ id }) => chat.delete(id, () => Message.DeletedConversation({ id }), failed('delete the chat')),
  })

  const SetServerDials = Command.define('ChatServerDials', {
    args: {
      speed: Schema.Literals(['slow', 'normal', 'fast']),
      chaos: Schema.Struct({
        failMidStream: Schema.Boolean,
        dropConnection: Schema.Boolean,
        slowFirstToken: Schema.Boolean,
        refuseSend: Schema.Boolean,
      }),
    },
    messages: [Message.AppliedServerDials],
    execute: ({ speed, chaos }) =>
      Effect.sync(() => {
        // The pretend server's own dials. A real app has no such door.
        server.setTiming(SPEEDS[speed])
        server.setChaos(chaos)
        return Message.AppliedServerDials()
      }),
  })

  /** Longer than a push takes, on any phone. Only used if the phone never says it appeared. */
  const PUSH_WAIT_MS = 700

  const WaitForPush = Command.define('ChatWaitForPush', {
    messages: [Message.WaitedForPush],
    execute: Effect.sleep(Duration.millis(PUSH_WAIT_MS)).pipe(Effect.as(Message.WaitedForPush())),
  })

  const FocusDraft = Command.define('ChatFocusDraft', {
    messages: [Message.CompletedSideEffect],
    execute: focusField(DRAFT_FIELD).pipe(Effect.as(Message.CompletedSideEffect())),
  })

  /** Raises the keyboard in a new chat, once: on the first of the two Messages that may say the push is done. */
  const focusIfPending = (model: Model): Return =>
    model.isDraftFocusPending && model.isChatOpen
      ? { model: modifyFields(model, { isDraftFocusPending: () => false }), commands: [FocusDraft()] }
      : { model }

  const ScrollToEnd = Command.define('ChatScrollToEnd', {
    messages: [Message.CompletedSideEffect],
    execute: scrollListToEnd(TRANSCRIPT_ID, { animated: true }).pipe(Effect.as(Message.CompletedSideEffect())),
  })

  const CloseSwipes = Command.define('ChatCloseSwipes', {
    messages: [Message.CompletedSideEffect],
    execute: closeAllSwipes('chats').pipe(
      Effect.andThen(closeNativeSwipes('chats')),
      Effect.as(Message.CompletedSideEffect()),
    ),
  })

  const ReadClock = Command.define('ChatReadClock', {
    messages: [Message.GotTime],
    execute: Effect.sync(() => Message.GotTime({ at: now() })),
  })

  const LoadSettings = Command.define('ChatLoadSettings', {
    messages: [Message.LoadedSettings],
    execute: Storage.Storage.use(storage => storage.get(SETTINGS_KEY)).pipe(
      Effect.map(maybe => Option.flatMap(maybe, decodeSettings)),
      Effect.catch(() => Effect.succeed(Option.none())),
      Effect.map(maybe => Message.LoadedSettings({ settings: Option.getOrElse(maybe, () => DEFAULT_SETTINGS) })),
    ),
  })

  const SaveSettings = Command.define('ChatSaveSettings', {
    args: { settings: Settings },
    messages: [Message.CompletedSideEffect],
    execute: ({ settings }) =>
      Storage.Storage.use(storage => storage.set(SETTINGS_KEY, JSON.stringify(settings))).pipe(
        Effect.catch(() => Effect.void),
        Effect.as(Message.CompletedSideEffect()),
      ),
  })

  const SetAppearance = Command.define('ChatSetAppearance', {
    args: { theme: Schema.Literals(['system', 'light', 'dark']) },
    messages: [Message.ChangedColorScheme],
    execute: ({ theme }) =>
      Appearance.use(appearance => appearance.set(theme)).pipe(Effect.map(scheme => Message.ChangedColorScheme({ scheme }))),
  })

  const ClearNoticeLater = Command.define('ChatClearNotice', {
    args: { text: Schema.String },
    messages: [Message.DismissedNotice],
    execute: ({ text }) => Effect.sleep(Duration.millis(NOTICE_MS)).pipe(Effect.as(Message.DismissedNotice({ text }))),
  })

  const haptic = {
    light: () => Command.mapMessage(Haptics.Impact({ style: 'light' }), ignore),
    medium: () => Command.mapMessage(Haptics.Impact({ style: 'medium' }), ignore),
    tick: () => Command.mapMessage(Haptics.Select(), ignore),
    success: () => Command.mapMessage(Haptics.Notify({ type: 'success' }), ignore),
    warning: () => Command.mapMessage(Haptics.Notify({ type: 'warning' }), ignore),
    error: () => Command.mapMessage(Haptics.Notify({ type: 'error' }), ignore),
  }

  const dismissKeyboard = () =>
    Command.mapMessage(Keyboard.Dismiss(), message => Message.GotKeyboardMessage({ message }))

  const fromRecorder = (message: Recorder.Message) => Message.GotRecorderMessage({ message })

  // INIT

  const init = (): Return => ({
    model: {
      scheme: 'light',
      settings: DEFAULT_SETTINGS,
      chaos: { failMidStream: false, dropConnection: false, slowFirstToken: false, refuseSend: false },
      showsNumbers: false,
      nowMs: now(),
      list: AsyncResult.initial(),
      query: '',
      isChatOpen: false,
      openId: Option.none(),
      conversation: AsyncResult.initial(),
      pending: [],
      live: Option.none(),
      joiningTurnId: Option.none(),
      nextClientId: 1,
      draft: '',
      isDraftFocusPending: false,
      attachment: Option.none(),
      recording: Option.none(),
      anchorKey: Option.none(),
      isAtEnd: true,
      tickedTurnId: Option.none(),
      notice: Option.none(),
      menu: Option.none(),
      keyboardHeight: 0,
      keyboardCovers: 0,
      isOnline: true,
      sheet: Option.none(),
    },
    commands: [LoadSettings()],
  })

  // UPDATE

  const withNotice = (model: Model, text: string, tone: 'info' | 'error'): Return => ({
    model: modifyFields(model, { notice: () => Option.some({ text, tone }) }),
    commands: [ClearNoticeLater({ text })],
  })

  const dials = (model: Model) => SetServerDials({ speed: model.settings.speed, chaos: model.chaos })

  const openChat = (model: Model, maybeId: Option.Option<string>): Model =>
    modifyFields(model, {
      isChatOpen: () => true,
      openId: () => maybeId,
      conversation: () => AsyncResult.initial(),
      pending: () => [],
      live: () => Option.none(),
      joiningTurnId: () => Option.none(),
      draft: () => '',
      isDraftFocusPending: () => false,
      attachment: () => Option.none(),
      recording: () => Option.none(),
      anchorKey: () => Option.none(),
      isAtEnd: () => true,
      notice: () => Option.none(),
      menu: () => Option.none(),
    })

  const closeChat = (model: Model): Model =>
    modifyFields(openChat(model, Option.none()), { isChatOpen: () => false })

  /** Sends `text` in the open chat, making the conversation first in a new one. */
  const send = (model: Model, text: string): Return => {
    if (text.trim() === '' || !model.isOnline || LiveTurnOps.isStreaming(model.live)) return { model }
    const clientMessageId = `c${model.nextClientId}`
    const attachments = Option.match(model.attachment, { onNone: () => [], onSome: each => [each] })
    const conversationId = Option.getOrElse(model.openId, () => '')
    const next = modifyFields(model, {
      nextClientId: count => count + 1,
      // Shown at once, before the server has it.
      pending: pending =>
        PendingOps.add(pending, { clientMessageId, conversationId, text, attachments, createdAt: model.nowMs }),
      draft: () => '',
      isDraftFocusPending: () => false,
      attachment: () => Option.none(),
      // The list brings this question near the top by itself.
      anchorKey: () => Option.some(clientMessageId),
      notice: () => Option.none(),
    })
    return {
      model: next,
      commands: [
        Option.isSome(model.openId) ? Send({ conversationId, text, clientMessageId, attachments }) : Create(),
        haptic.light(),
        dismissKeyboard(),
      ],
    }
  }

  const regenerate = (model: Model): Return => {
    if (Option.isNone(model.openId) || LiveTurnOps.isStreaming(model.live) || !model.isOnline) return { model }
    return {
      model: modifyFields(model, { anchorKey: () => lastQuestionKey(chatRows(model)), notice: () => Option.none() }),
      commands: [Regenerate({ conversationId: model.openId.value }), haptic.light()],
    }
  }

  /** Follows a reply again from its last piece: after the app or the network was away. */
  const resumeStreaming = (model: Model): Return =>
    Option.match(Option.filter(model.live, each => each.status === 'streaming'), {
      onNone: () => ({ model }),
      onSome: live => ({
        model: modifyFields(model, { live: () => Option.some(LiveTurnOps.resuming(live)) }),
        commands: [Resume({ turnId: live.turnId, delayMs: 0 })],
      }),
    })

  const onTurnUpdate = (model: Model, update: TurnUpdate): Return => {
    const next = modifyFields(model, { live: () => LiveTurnOps.apply(model.live, update) })
    if (Option.isNone(next.live)) return { model: next }
    const live = next.live.value
    if (update._tag === 'TextBatch' && !Option.contains(model.tickedTurnId, live.turnId)) {
      return {
        model: modifyFields(next, { tickedTurnId: () => Option.some(live.turnId) }),
        commands: [haptic.tick()],
      }
    }
    if (update._tag === 'TurnFailed') return { model: next, commands: [haptic.error()] }
    if (update._tag === 'ConnectionLost' && live.status === 'streaming') {
      if (live.lostCount > MAX_RECONNECTS) return { model: next }
      return {
        model: modifyFields(next, { live: () => Option.some(LiveTurnOps.resuming(live)) }),
        commands: [Resume({ turnId: live.turnId, delayMs: reconnectDelayMs(live.lostCount) })],
      }
    }
    return { model: next }
  }

  /** A reply found running when a chat opens, as a live turn to follow. */
  const joinedLive = (conversation: Conversation, turnId: string): Option.Option<LiveTurn> => {
    const index = conversation.messages.findIndex(each => each.turnId === turnId && each.role === 'assistant')
    const reply = conversation.messages[index]
    const question = conversation.messages.slice(0, Math.max(0, index)).reverse().find(each => each.role === 'user')
    if (reply === undefined || question === undefined) return Option.none()
    return Option.some({
      turnId,
      conversationId: conversation.id,
      messageId: reply.id,
      userMessageId: question.id,
      lastSeq: 0,
      parts: [],
      status: 'streaming',
      connection: 'open',
      lostCount: 0,
      isStopping: false,
      failure: null,
      isRetryable: false,
      usage: null,
    })
  }

  const onActionSheet = (model: Model, message: ActionSheet.Message): Return => {
    const closed = modifyFields(model, { menu: () => Option.none() })
    if (message._tag !== 'SelectedActionSheetItem') return { model: closed }
    return Option.match(model.menu, {
      onNone: () => ({ model: closed }),
      onSome: menu => {
        switch (message.key) {
          case 'copy': {
            const shown = withNotice(closed, 'Copied', 'info')
            return {
              model: shown.model,
              commands: [
                Command.mapMessage(Clipboard.CopyText({ text: menu.text }), ignore),
                haptic.success(),
                ...(shown.commands ?? []),
              ],
            }
          }
          case 'share':
            return { model: closed, commands: [Command.mapMessage(Share.Open({ message: menu.text }), ignore)] }
          case 'select':
            return { model: modifyFields(closed, { sheet: () => Option.some({ _tag: 'SelectText' as const, rowKey: menu.rowKey }) }) }
          case 'regenerate':
            return regenerate(closed)
          case 'stop':
            return update(closed, Message.PressedStop())
          default:
            return { model: closed }
        }
      },
    })
  }

  const onRecorder = (model: Model, message: Recorder.Message): Return => {
    switch (message._tag) {
      case 'GotPermission':
        if (message.permission === 'granted') {
          return {
            model: modifyFields(model, { recording: () => Option.some({ seconds: 0, isNearLimit: false }) }),
            commands: [
              Command.mapMessage(Recorder.Start({ maxSeconds: RECORDING_LIMIT_S, warnSeconds: RECORDING_WARN_S }), fromRecorder),
              haptic.medium(),
              dismissKeyboard(),
            ],
          }
        }
        return withNotice(model, 'Microphone access is off. Turn it on in the Settings app.', 'error')
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
        return withNotice(modifyFields(model, { recording: () => Option.none() }), `Could not record: ${message.reason}`, 'error')
      default:
        return { model }
    }
  }

  const update = (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      // THE PHONE AND THE SETTINGS
      ChangedColorScheme: ({ scheme }) => ({ model: modifyFields(model, { scheme: () => scheme }) }),
      LoadedSettings: ({ settings }) => {
        const next = modifyFields(model, { settings: () => settings })
        return {
          model: next,
          commands: [dials(next), ...(settings.theme === 'system' ? [] : [SetAppearance({ theme: settings.theme })])],
        }
      },
      PressedTheme: ({ theme }) => {
        const settings = { ...model.settings, theme }
        return {
          model: modifyFields(model, { settings: () => settings }),
          commands: [SetAppearance({ theme }), SaveSettings({ settings }), haptic.tick()],
        }
      },
      PressedSpeed: ({ speed }) => {
        const next = modifyFields(model, { settings: settings => ({ ...settings, speed }) })
        return { model: next, commands: [dials(next), SaveSettings({ settings: next.settings }), haptic.tick()] }
      },
      PressedChaos: ({ name }) => {
        const next = modifyFields(model, { chaos: chaos => ({ ...chaos, [name]: !chaos[name] }) })
        return { model: next, commands: [dials(next)] }
      },
      AppliedServerDials: () => ({ model }),
      PressedNumbers: () => ({ model: modifyFields(model, { showsNumbers: shows => !shows }), commands: [haptic.tick()] }),
      GotTime: ({ at }) => ({ model: modifyFields(model, { nowMs: () => at }) }),
      ChangedNetwork: ({ isOnline }) => {
        const next = modifyFields(model, { isOnline: () => isOnline })
        return isOnline && !model.isOnline ? resumeStreaming(next) : { model: next }
      },
      // The phone may have closed the connection while the app was away,
      // without saying so. Resuming from the last piece costs one request.
      ReturnedToApp: () => {
        const resumed = resumeStreaming(model)
        return { model: resumed.model, commands: [...(resumed.commands ?? []), ReadClock()] }
      },
      GotKeyboardMessage: ({ message: keyboard }) => ({
        model: modifyFields(model, {
          keyboardCovers: covers =>
            Keyboard.Message.match(keyboard, {
              ShownKeyboard: shown => shown.covers,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => covers,
            }),
          keyboardHeight: height =>
            Keyboard.Message.match(keyboard, {
              ShownKeyboard: shown => shown.height,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => height,
            }),
        }),
      }),
      CompletedSideEffect: () => ({ model }),

      // THE LIST
      ChangedList: ({ result }) => ({ model: modifyFields(model, { list: () => result }), commands: [ReadClock()] }),
      ChangedQuery: ({ text }) => ({ model: modifyFields(model, { query: () => text }) }),
      PressedConversation: ({ id }) => ({ model: openChat(model, Option.some(id)), commands: [CloseSwipes()] }),
      // The keyboard comes up once the push has finished: see `focus.ts`.
      PressedNewChat: () => ({
        model: modifyFields(openChat(model, Option.none()), {
          sheet: () => Option.none(),
          isDraftFocusPending: () => true,
        }),
        commands: [CloseSwipes(), WaitForPush()],
      }),
      PressedSettings: () => ({ model: modifyFields(model, { sheet: () => Option.some({ _tag: 'Settings' as const }) }) }),
      SelectedRowAction: ({ id, key }) => {
        if (key === 'rename') {
          const title = Option.getOrElse(
            Option.map(
              Option.flatMap(AsyncResult.value(model.list), list => Option.fromNullishOr(list.find(each => each.id === id))),
              each => each.title,
            ),
            () => '',
          )
          return {
            model: modifyFields(model, { sheet: () => Option.some({ _tag: 'Rename' as const, id, title }) }),
            commands: [CloseSwipes()],
          }
        }
        if (key === 'delete') {
          // Gone from the list at once. The server's answer confirms it.
          const without = modifyFields(model, {
            list: list => AsyncResult.map(list, summaries => summaries.filter(each => each.id !== id)),
          })
          const next = Option.contains(model.openId, id) ? closeChat(without) : without
          return { model: next, commands: [Delete({ id }), haptic.warning()] }
        }
        return { model }
      },
      ArmedFullSwipe: ({ isArmed }) => ({ model, commands: isArmed ? [haptic.light()] : [] }),

      // ONE CHAT
      AppearedChat: () => focusIfPending(model),
      WaitedForPush: () => focusIfPending(model),
      PoppedChat: () => ({ model: closeChat(model), commands: [dismissKeyboard()] }),
      ChangedConversation: ({ id, result }) => {
        if (!Option.contains(model.openId, id)) return { model }
        const next = modifyFields(model, {
          conversation: () => result,
          ...Option.match(AsyncResult.value(result), {
            onNone: () => ({}),
            onSome: conversation => ({
              pending: (pending: Model['pending']) => PendingOps.settle(pending, conversation),
              live: (live: Model['live']) => LiveTurnOps.settle(live, conversation),
            }),
          }),
        })
        // A reply still being written when the chat was opened: join it.
        const running = Option.flatMap(AsyncResult.value(result), conversation =>
          Option.fromNullishOr(conversation.activeTurnId),
        )
        if (Option.isSome(running) && Option.isNone(next.live) && Option.isNone(next.joiningTurnId)) {
          return {
            model: modifyFields(next, { joiningTurnId: () => running }),
            commands: [Resume({ turnId: running.value, delayMs: 0 })],
          }
        }
        return { model: next }
      },
      SelectedChatMenu: ({ key }) => {
        if (key === 'settings') {
          return { model: modifyFields(model, { sheet: () => Option.some({ _tag: 'Settings' as const }) }), commands: [dismissKeyboard()] }
        }
        return Option.match(model.openId, {
          onNone: () => ({ model }),
          onSome: id => update(model, Message.SelectedRowAction({ id, key })),
        })
      },
      ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text, notice: () => Option.none() }) }),
      PressedSend: () => send(model, model.draft.trim()),
      PressedSuggestion: ({ text }) => send(model, text),
      CreatedConversation: ({ id }) => {
        // The first message of a new chat waited for its conversation.
        const waiting = model.pending.filter(each => each.conversationId === '')
        return {
          model: modifyFields(model, {
            openId: open => (Option.isNone(open) && model.isChatOpen ? Option.some(id) : open),
            pending: pending => pending.map(each => (each.conversationId === '' ? { ...each, conversationId: id } : each)),
          }),
          commands: waiting.map(each =>
            Send({ conversationId: id, text: each.text, clientMessageId: each.clientMessageId, attachments: each.attachments }),
          ),
        }
      },
      StartedTurn: ({ started }) => ({
        model: modifyFields(model, {
          live: () => Option.some(LiveTurnOps.start(started)),
          joiningTurnId: () => Option.none(),
        }),
      }),
      FailedSend: ({ clientMessageId, text, reason }) => {
        const next = modifyFields(model, {
          pending: pending => PendingOps.rollBack(pending, clientMessageId),
          // What you wrote goes back in the field, so nothing is lost.
          draft: draft => (draft.trim() === '' ? text : draft),
          anchorKey: () => Option.none(),
        })
        const shown = withNotice(next, `Not sent. ${reason}`, 'error')
        return { model: shown.model, commands: [...(shown.commands ?? []), haptic.error()] }
      },
      PressedStop: () =>
        Option.match(Option.filter(model.live, each => each.status === 'streaming'), {
          onNone: () => ({ model }),
          onSome: live => ({
            model: modifyFields(model, { live: () => Option.some(LiveTurnOps.stopping(live)) }),
            commands: [Stop({ turnId: live.turnId }), haptic.medium()],
          }),
        }),
      StoppedTurn: () => ({ model }),
      PressedRegenerate: () => regenerate(model),
      StartedRegenerate: ({ started }) => ({ model: modifyFields(model, { live: () => Option.some(LiveTurnOps.start(started)) }) }),
      ReceivedTurnUpdate: ({ update: turnUpdate }) => onTurnUpdate(model, turnUpdate),
      Resumed: ({ turnId }) =>
        Option.contains(model.joiningTurnId, turnId)
          ? {
              model: modifyFields(model, {
                joiningTurnId: () => Option.none(),
                live: live =>
                  Option.isSome(live)
                    ? live
                    : Option.flatMap(AsyncResult.value(model.conversation), conversation => joinedLive(conversation, turnId)),
              }),
            }
          : { model },
      PressedReconnect: () =>
        Option.match(Option.filter(model.live, each => each.status === 'streaming'), {
          onNone: () => ({ model }),
          onSome: live => ({
            model: modifyFields(model, { live: () => Option.some({ ...LiveTurnOps.resuming(live), lostCount: 0 }) }),
            commands: [Resume({ turnId: live.turnId, delayMs: 0 })],
          }),
        }),
      FailedWrite: ({ action, reason }) => {
        // A new chat that could not be made: its first message comes back.
        const waiting = model.pending.filter(each => each.conversationId === '')
        const next = modifyFields(model, {
          pending: pending => pending.filter(each => each.conversationId !== ''),
          draft: draft => (draft.trim() === '' && waiting[0] !== undefined ? waiting[0].text : draft),
          live: live => Option.map(live, each => ({ ...each, isStopping: false })),
        })
        const shown = withNotice(next, `Could not ${action}. ${reason}`, 'error')
        return { model: shown.model, commands: [...(shown.commands ?? []), haptic.error()] }
      },
      ChangedAtEnd: ({ isAtEnd }) => ({ model: modifyFields(model, { isAtEnd: () => isAtEnd }) }),
      PressedScrollToEnd: () => ({ model, commands: [ScrollToEnd()] }),
      // Android's scroll view cannot put the keyboard away by itself.
      DraggedListWithKeyboardUp: () => ({ model, commands: [dismissKeyboard()] }),
      TappedTranscript: () => ({ model, commands: model.keyboardHeight > 0 ? [dismissKeyboard()] : [] }),
      LongPressedMessage: ({ rowKey }) => {
        const row = chatRows(model).find(each => each.key === rowKey)
        if (row === undefined) return { model }
        const canRegenerate = row.role === 'assistant' && row.isLastReply && !LiveTurnOps.isStreaming(model.live)
        const text = textOf(row.parts)
        // A reply still being written: what is there so far, and a way to end it.
        const items =
          row.role === 'assistant' && row.status === 'streaming'
            ? [...(text === '' ? [] : [{ key: 'copy', title: 'Copy so far' }]), { key: 'stop', title: 'Stop' }]
            : [
                { key: 'copy', title: 'Copy' },
                { key: 'select', title: 'Select text' },
                { key: 'share', title: 'Share' },
                ...(canRegenerate ? [{ key: 'regenerate', title: 'Regenerate' }] : []),
              ]
        return {
          model: modifyFields(model, { menu: () => Option.some({ rowKey, text, canRegenerate }) }),
          commands: [
            haptic.medium(),
            Command.mapMessage(
              ActionSheet.Show({ items }),
              sheetMessage => Message.GotActionSheetMessage({ message: sheetMessage }),
            ),
          ],
        }
      },
      GotActionSheetMessage: ({ message: sheetMessage }) => onActionSheet(model, sheetMessage),
      PressedReplyAction: ({ rowKey, key }) => {
        const row = chatRows(model).find(each => each.key === rowKey)
        if (row === undefined) return { model }
        const menu = { rowKey, text: textOf(row.parts), canRegenerate: row.isLastReply }
        return onActionSheet(
          modifyFields(model, { menu: () => Option.some(menu) }),
          ActionSheet.Message.SelectedActionSheetItem({ key }),
        )
      },
      PressedLink: ({ url }) => ({ model, commands: [Command.mapMessage(Linking.OpenUrl({ url }), ignore)] }),
      CopiedCode: () => {
        const shown = withNotice(model, 'Code copied', 'info')
        return { model: shown.model, commands: [...(shown.commands ?? []), haptic.success()] }
      },
      DismissedNotice: ({ text }) => ({
        model: modifyFields(model, { notice: notice => Option.filter(notice, each => each.text !== text) }),
      }),

      // SHEETS
      PressedReasoning: ({ rowKey }) => ({
        model: modifyFields(model, { sheet: () => Option.some({ _tag: 'Reasoning' as const, rowKey }) }),
        commands: [dismissKeyboard()],
      }),
      ClosedSheet: () => ({ model: modifyFields(model, { sheet: () => Option.none() }), commands: [dismissKeyboard()] }),
      ChangedRenameDraft: ({ text }) => ({
        model: modifyFields(model, {
          sheet: sheet => Option.map(sheet, open => (open._tag === 'Rename' ? { ...open, title: text } : open)),
        }),
      }),
      PressedSaveRename: () =>
        Option.match(Option.filter(model.sheet, open => open._tag === 'Rename' && open.title.trim() !== ''), {
          onNone: () => ({ model }),
          onSome: open =>
            open._tag === 'Rename'
              ? {
                  model: modifyFields(model, { sheet: () => Option.none() }),
                  commands: [Rename({ id: open.id, title: open.title.trim() }), dismissKeyboard()],
                }
              : { model },
        }),
      RenamedConversation: () => ({ model }),
      DeletedConversation: () => ({ model }),

      // VOICE NOTES
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
    })

  // SUBSCRIPTIONS

  const subscriptions = Subscription.make<Model, Message, Resources>()(entry => ({
    colorScheme: ColorScheme.changesEntry(each => Message.ChangedColorScheme({ scheme: each.scheme })),
    keyboard: Keyboard.changesEntry(each => Message.GotKeyboardMessage({ message: each })),
    network: Network.changesEntry(each => Message.ChangedNetwork({ isOnline: each.status === 'online' })),
    focus: focusEntry((): Message => Message.ReturnedToApp()),
    list: watchAtom(
      { isShown: Schema.Boolean },
      {
        modelToDependencies: () => ({ isShown: true }),
        atom: () => Option.some(chat.conversationList),
        toMessage: (result): Message => Message.ChangedList({ result }),
      },
    ),
    conversation: watchAtom(
      { maybeOpenId: Schema.Option(Schema.String) },
      {
        modelToDependencies: (model: Model) => ({ maybeOpenId: model.isChatOpen ? model.openId : Option.none() }),
        atom: ({ maybeOpenId }) => Option.map(maybeOpenId, chat.conversation),
        toMessage: (result, { maybeOpenId }): Message =>
          Message.ChangedConversation({ id: Option.getOrElse(maybeOpenId, () => ''), result }),
      },
    ),
    // The reply being written: a few Messages a second, however fast it comes.
    turn: chat.liveTurnEntry<Model, Message>({
      modelToTurnId: model =>
        Option.map(
          Option.filter(model.live, live => live.status === 'streaming'),
          live => live.turnId,
        ),
      toMessage: update => Message.ReceivedTurnUpdate({ update }),
      ...(options.batchMs === undefined ? {} : { batchMs: options.batchMs }),
    }),
    // The recorder's clock, only while recording.
    recorder: entry(
      { isRecording: Schema.Boolean },
      {
        modelToDependencies: model => ({ isRecording: Option.isSome(model.recording) }),
        dependenciesToStream: ({ isRecording }) =>
          isRecording ? Stream.map(Recorder.status, fromRecorder) : Stream.empty,
      },
    ),
  }))

  // VIEW

  const view = (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'app-stack')],
      [
        listScreen(h, env.device, model),
        ...(model.isChatOpen ? [chatScreen(h, env.device, model)] : []),
        ...sheetScreens(h, env.device, model),
      ],
    )

  const program = Runtime.makeElement({
    Model,
    init,
    update,
    view,
    subscriptions,
    resources: Layer.mergeAll(chat.layer, resources),
    container,
  })

  return { program, server, link, chat, init, update, view, chatTitle }
}
