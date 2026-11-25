/**
 * Fold Chat: the program. It routes and wires its parts and keeps what they
 * share. The parts are in `parts/`: the list of chats, the chat screen (with
 * its transcript, message rows, reply stream and composer), and the settings
 * and reasoning sheets. The top-level Model and Messages are in
 * `appModel.ts`, the shared values in `context.ts`.
 *
 * The replies come from the pretend AI server inside the app
 * (src/aiChat), reached through Effect's RPC client as lines of JSON. The
 * reconnect and background rules are the ones `test/demos/aiBackend.ts`
 * established: on a lost connection, try again after 0.25, 0.5, 1, 2 and 4
 * seconds, then offer a button; on return to the app (or to the network)
 * with a reply still being written, resume it at once.
 */
import { Effect, Layer, Option, Schema, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import {
  type AiServer,
  type Disk,
  type InProcessLink,
  SPEEDS,
  diskFromFiles,
  layerInProcess,
  makeAiChat,
  makeAiServer,
  makeInProcessLink,
  memoryDisk,
} from '../src/aiChat/index.js'
import {
  ColorScheme,
  Keyboard,
  Native,
  Network,
  Recorder,
  Storage,
  type Services,
} from '../src/device/index.js'
import { type NativeCrashOptions, nativeCrash } from '../src/foldkit/devLoop/crashView.js'
import { type Device, stack } from '../src/foldkit/navigation/stack.js'
import { ActionSheet } from '../src/menus/index.js'
import { type ServerState, focusEntry, watchAtom } from '../src/serverState/index.js'
import { closeAllSwipes } from '../src/swipe/index.js'
import { closeNativeSwipes } from '../src/swipeNative/index.js'
import { Appearance } from './appearance.js'
import { Message, Model } from './appModel.js'
import type { Context } from './context.js'
import { dismissKeyboard, haptics } from './effects.js'
import { DEFAULT_SETTINGS, Settings } from './model.js'
import * as ChatScreen from './parts/chatScreen.js'
import * as Composer from './parts/composer.js'
import * as ConversationList from './parts/conversationList.js'
import * as ReasoningSheet from './parts/reasoningSheet.js'
import * as ReplyStream from './parts/replyStream.js'
import * as SettingsSheet from './parts/settingsSheet.js'
import { sheetScreens } from './sheets.js'

export { Message, Model } from './appModel.js'

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
  /**
   * Hears every Message the program handles, with the Model before and after
   * it. For a log that replays a session (see test/flagship/replay.test.ts).
   */
  onMessage?: (message: Message, before: Model, after: Model) => void
  /** The crash screen's buttons and words. It is drawn with native views either way. */
  crash?: NativeCrashOptions
}>

/** What the program needs from outside: the phone, the action sheet, the theme. */
export type ChatAppResources = Services | ActionSheet.ActionSheet | Appearance

const SETTINGS_KEY = 'fold-chat.settings'

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

const toChat = (message: ChatScreen.Message) => Message.GotChatScreenMessage({ message })
const toList = (message: ConversationList.Message) => Message.GotConversationListMessage({ message })

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
  const chatCommands = ChatScreen.makeCommands(chat)

  type Resources = ServerState | ChatAppResources
  type Return = Update.Return<Model, Message, Resources>

  // COMMANDS

  const failed = (action: string) => (reason: string) => Message.FailedWrite({ action, reason })

  const Rename = Command.define('ChatRename', {
    args: { id: Schema.String, title: Schema.String },
    messages: [Message.RenamedConversation, Message.FailedWrite],
    execute: ({ id, title }) => chat.rename(id, title, () => Message.RenamedConversation(), failed('rename the chat')),
  })

  const Delete = Command.define('ChatDelete', {
    args: { id: Schema.String },
    messages: [Message.DeletedConversation, Message.FailedDelete],
    execute: ({ id }) =>
      chat.delete(id, () => Message.DeletedConversation({ id }), reason => Message.FailedDelete({ id, reason })),
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

  const done = () => Message.CompletedSideEffect()
  const haptic = haptics(done)

  // INIT

  const init = (): Return => ({
    model: {
      shared: {
        scheme: 'light',
        settings: DEFAULT_SETTINGS,
        chaos: { failMidStream: false, dropConnection: false, slowFirstToken: false, refuseSend: false },
        showsNumbers: false,
        nowMs: now(),
        isOnline: true,
        keyboardHeight: 0,
        keyboardCovers: 0,
      },
      list: AsyncResult.initial(),
      deleting: [],
      conversation: AsyncResult.initial(),
      conversations: ConversationList.init(),
      chat: ChatScreen.init(),
      sheet: Option.none(),
    },
    commands: [LoadSettings()],
  })

  // UPDATE

  const dials = (model: Model) => SetServerDials({ speed: model.shared.settings.speed, chaos: model.shared.chaos })

  const withShared = (model: Model, change: (shared: Model['shared']) => Model['shared']): Model =>
    modifyFields(model, { shared: change })

  const chatInputs = (model: Model): ChatScreen.Inputs => ({
    shared: model.shared,
    conversation: model.conversation,
    commands: chatCommands,
  })

  /** A chat Return, lifted into the app. */
  const withChat = (
    model: Model,
    result: Readonly<{ model: ChatScreen.Model; commands?: Update.Return<ChatScreen.Model, ChatScreen.Message, Resources>['commands'] }>,
  ): Return => ({
    model: modifyFields(model, { chat: () => result.model }),
    commands: Command.mapMessages(result.commands ?? [], toChat),
  })

  const openChat = (model: Model, maybeId: Option.Option<string>): Model =>
    modifyFields(model, { conversation: () => AsyncResult.initial(), chat: chat_ => ChatScreen.open(chat_, maybeId) })

  /** The list as it is shown: the server's, less the chats being deleted. */
  const shownList = (model: Model): Model['list'] =>
    model.deleting.length === 0
      ? model.list
      : AsyncResult.map(model.list, summaries => summaries.filter(each => !model.deleting.includes(each.id)))

  const closeChat = (model: Model): Model =>
    modifyFields(model, { conversation: () => AsyncResult.initial(), chat: ChatScreen.close })

  const closeSheet = (model: Model): Return => ({
    model: modifyFields(model, { sheet: () => Option.none() }),
    commands: [dismissKeyboard(done)],
  })

  /** Rename or Delete, from the list or from the chat's own menu. */
  const rowAction = (model: Model, id: string, key: string): Return => {
    if (key === 'rename') {
      const title = Option.getOrElse(
        Option.map(
          Option.flatMap(AsyncResult.value(shownList(model)), list => Option.fromNullishOr(list.find(each => each.id === id))),
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
      // Gone from the list at once, and kept out of it until the server's
      // list no longer has it (see `deleting` in appModel.ts).
      const without = modifyFields(model, { deleting: ids => (ids.includes(id) ? ids : [...ids, id]) })
      const next = Option.contains(model.chat.openId, id) ? closeChat(without) : without
      return { model: next, commands: [Delete({ id }), haptic.warning()] }
    }
    return { model }
  }

  const toggleNumbers = (model: Model): Return => ({
    model: withShared(model, shared => ({ ...shared, showsNumbers: !shared.showsNumbers })),
    commands: [haptic.tick()],
  })

  const onList = (model: Model, message: ConversationList.Message): Return => {
    const result = ConversationList.update(model.conversations, message)
    const next = modifyFields(model, { conversations: () => result.model })
    if (result.outMessage === undefined) return { model: next }
    return ConversationList.OutMessage.match<Return>(result.outMessage, {
      OpenedConversation: ({ id }) => ({ model: openChat(next, Option.some(id)), commands: [CloseSwipes()] }),
      StartedNewChat: () => {
        const opened = ChatScreen.startNew(modifyFields(next, { conversation: () => AsyncResult.initial() }).chat)
        return {
          model: modifyFields(next, {
            conversation: () => AsyncResult.initial(),
            chat: () => opened.model,
            sheet: () => Option.none(),
          }),
          commands: [CloseSwipes(), ...Command.mapMessages(opened.commands ?? [], toChat)],
        }
      },
      OpenedSettings: () => ({ model: modifyFields(next, { sheet: () => Option.some({ _tag: 'Settings' as const }) }) }),
      ChoseRowAction: ({ id, key }) => rowAction(next, id, key),
      ArmedFullSwipe: ({ isArmed }) => ({ model: next, commands: isArmed ? [haptic.light()] : [] }),
    })
  }

  const onChat = (model: Model, message: ChatScreen.Message): Return => {
    const result = ChatScreen.update(model.chat, message, chatInputs(model))
    const next = withChat(model, result)
    if (result.outMessage === undefined) return next
    const after = ChatScreen.OutMessage.match<Return>(result.outMessage, {
      Closed: () => ({ model: closeChat(next.model), commands: [dismissKeyboard(done)] }),
      ChoseMenuItem: ({ key }) => {
        if (key === 'settings') {
          return {
            model: modifyFields(next.model, { sheet: () => Option.some({ _tag: 'Settings' as const }) }),
            commands: [dismissKeyboard(done)],
          }
        }
        return Option.match(next.model.chat.openId, {
          onNone: () => ({ model: next.model }),
          onSome: id => rowAction(next.model, id, key),
        })
      },
      PressedNumbers: () => toggleNumbers(next.model),
      OpenedSheet: ({ sheet }) => ({ model: modifyFields(next.model, { sheet: () => Option.some(sheet) }) }),
    })
    return { model: after.model, commands: [...(next.commands ?? []), ...(after.commands ?? [])] }
  }

  const onSettings = (model: Model, message: SettingsSheet.Message): Return => {
    const result = SettingsSheet.update({}, message)
    if (result.outMessage === undefined) return { model }
    return SettingsSheet.OutMessage.match<Return>(result.outMessage, {
      PressedTheme: ({ theme }) => {
        const settings = { ...model.shared.settings, theme }
        return {
          model: withShared(model, shared => ({ ...shared, settings })),
          commands: [SetAppearance({ theme }), SaveSettings({ settings }), haptic.tick()],
        }
      },
      PressedSpeed: ({ speed }) => {
        const next = withShared(model, shared => ({ ...shared, settings: { ...shared.settings, speed } }))
        return { model: next, commands: [dials(next), SaveSettings({ settings: next.shared.settings }), haptic.tick()] }
      },
      PressedChaos: ({ name }) => {
        const next = withShared(model, shared => ({ ...shared, chaos: { ...shared.chaos, [name]: !shared.chaos[name] } }))
        return { model: next, commands: [dials(next)] }
      },
      PressedNumbers: () => toggleNumbers(model),
      Closed: () => closeSheet(model),
    })
  }

  const update = (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      // THE PHONE AND THE SETTINGS
      ChangedColorScheme: ({ scheme }) => ({ model: withShared(model, shared => ({ ...shared, scheme })) }),
      LoadedSettings: ({ settings }) => {
        const next = withShared(model, shared => ({ ...shared, settings }))
        return {
          model: next,
          commands: [dials(next), ...(settings.theme === 'system' ? [] : [SetAppearance({ theme: settings.theme })])],
        }
      },
      AppliedServerDials: () => ({ model }),
      GotTime: ({ at }) => ({ model: withShared(model, shared => ({ ...shared, nowMs: at })) }),
      ChangedNetwork: ({ isOnline }) => {
        const next = withShared(model, shared => ({ ...shared, isOnline }))
        return isOnline && !model.shared.isOnline ? withChat(next, ChatScreen.resume(next.chat, chatInputs(next))) : { model: next }
      },
      // The phone may have closed the connection while the app was away,
      // without saying so. Resuming from the last piece costs one request.
      ReturnedToApp: () => {
        const resumed = withChat(model, ChatScreen.resume(model.chat, chatInputs(model)))
        return { model: resumed.model, commands: [...(resumed.commands ?? []), ReadClock()] }
      },
      GotKeyboardMessage: ({ message: keyboard }) => ({
        model: withShared(model, shared => ({
          ...shared,
          keyboardCovers: Keyboard.Message.match(keyboard, {
            ShownKeyboard: shown => shown.covers,
            HidKeyboard: () => 0,
            CompletedDismissKeyboard: () => shared.keyboardCovers,
          }),
          keyboardHeight: Keyboard.Message.match(keyboard, {
            ShownKeyboard: shown => shown.height,
            HidKeyboard: () => 0,
            CompletedDismissKeyboard: () => shared.keyboardHeight,
          }),
        })),
      }),
      CompletedSideEffect: () => ({ model }),

      // SERVER DATA
      ChangedList: ({ result }) => ({
        model: modifyFields(model, {
          list: () => result,
          // A finished load without a deleted chat: the delete is done with.
          deleting: ids =>
            result._tag === 'Success' && !result.waiting
              ? ids.filter(id => result.value.some(each => each.id === id))
              : ids,
        }),
        commands: [ReadClock()],
      }),
      ChangedConversation: ({ id, result }) => {
        if (!Option.contains(model.chat.openId, id)) return { model }
        const next = modifyFields(model, { conversation: () => result })
        return withChat(next, ChatScreen.receivedConversation(next.chat, result, chatInputs(next)))
      },

      // THE PARTS
      GotConversationListMessage: ({ message: each }) => onList(model, each),
      GotChatScreenMessage: ({ message: each }) => onChat(model, each),
      GotSettingsSheetMessage: ({ message: each }) => onSettings(model, each),
      GotReasoningSheetMessage: ({ message: each }) => {
        const open = Option.getOrUndefined(model.sheet)
        if (open?._tag !== 'Reasoning') return { model }
        const result = ReasoningSheet.update({ rowKey: open.rowKey, detent: open.detent }, each)
        if (result.outMessage !== undefined) return closeSheet(model)
        return { model: modifyFields(model, { sheet: () => Option.some({ ...open, ...result.model }) }) }
      },

      // RENAME AND SELECT TEXT
      ClosedSheet: () => closeSheet(model),
      ChangedSheetDetent: ({ index }) => ({
        model: modifyFields(model, {
          sheet: sheet => Option.map(sheet, open => (open._tag === 'SelectText' ? { ...open, detent: index } : open)),
        }),
      }),
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
                  commands: [Rename({ id: open.id, title: open.title.trim() }), dismissKeyboard(done)],
                }
              : { model },
        }),
      RenamedConversation: () => ({ model }),
      DeletedConversation: () => ({ model }),
      FailedDelete: ({ id, reason }) =>
        withChat(
          modifyFields(model, { deleting: ids => ids.filter(each => each !== id) }),
          ChatScreen.writeFailed(model.chat, 'delete the chat', reason),
        ),
      FailedWrite: ({ action, reason }) => withChat(model, ChatScreen.writeFailed(model.chat, action, reason)),
    })

  const handle = (model: Model, message: Message): Return => {
    const result = update(model, message)
    options.onMessage?.(message, model, result.model)
    return result
  }

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
        modelToDependencies: (model: Model) => ({ maybeOpenId: model.chat.isOpen ? model.chat.openId : Option.none() }),
        atom: ({ maybeOpenId }) => Option.map(maybeOpenId, chat.conversation),
        toMessage: (result, { maybeOpenId }): Message =>
          Message.ChangedConversation({ id: Option.getOrElse(maybeOpenId, () => ''), result }),
      },
    ),
    // The reply being written: a few Messages a second, however fast it comes.
    turn: chat.liveTurnEntry<Model, Message>({
      modelToTurnId: model =>
        Option.map(
          Option.filter(model.chat.reply.live, live => live.status === 'streaming'),
          live => live.turnId,
        ),
      toMessage: update_ =>
        toChat(ChatScreen.Message.GotReplyStreamMessage({ message: ReplyStream.Message.ReceivedTurnUpdate({ update: update_ }) })),
      ...(options.batchMs === undefined ? {} : { batchMs: options.batchMs }),
    }),
    // The recorder's clock, only while recording.
    recorder: entry(
      { isRecording: Schema.Boolean },
      {
        modelToDependencies: model => ({ isRecording: Composer.isRecording(model.chat.composer) }),
        dependenciesToStream: ({ isRecording }) =>
          isRecording
            ? Stream.map(Recorder.status, message =>
                toChat(ChatScreen.Message.GotComposerMessage({ message: Composer.Message.GotRecorderMessage({ message }) })),
              )
            : Stream.empty,
      },
    ),
  }))

  // VIEW

  const view = (model: Model, h: HtmlBuilder<Message>): Html => {
    const context: Context = { device: env.device, shared: model.shared }
    return stack(
      [h.Attribute('testID', 'app-stack')],
      [
        h.submodel({
          slotId: 'conversations',
          view: ConversationList.view,
          model: model.conversations,
          viewInputs: { ...context, list: shownList(model) },
          toParentMessage: toList,
        }),
        ...(model.chat.isOpen
          ? [
              h.submodel({
                slotId: 'chat',
                view: ChatScreen.view,
                model: model.chat,
                viewInputs: { ...context, conversation: model.conversation },
                toParentMessage: toChat,
              }),
            ]
          : []),
        ...sheetScreens(h, env.device, model),
      ],
    )
  }

  const program = Runtime.makeElement({
    Model,
    init,
    update: handle,
    view,
    subscriptions,
    resources: Layer.mergeAll(chat.layer, resources),
    container,
    // Foldkit's own crash screen is made of web elements, which a phone
    // draws as lines of text piled up at the top of the screen.
    crash: nativeCrash<Model, Message>(options.crash),
  })

  const chatTitle = (model: Model): string => ChatScreen.chatTitle(model.chat, model.conversation)

  return { program, server, link, chat, init, update, view, chatTitle }
}
