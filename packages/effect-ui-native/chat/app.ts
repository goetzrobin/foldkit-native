/**
 * Effect Chat: the app. It owns the phone's screen stack and nothing else.
 *
 * The Model is the list of screens, the last one on top: the list of chats,
 * then at most one chat. Opening a chat adds a screen and the phone slides
 * it in. A swipe back is the phone's own: the screen says so afterwards and
 * the Model drops it, so the two agree again.
 *
 * Each screen is one part (`parts/`), a child component that draws a whole
 * native screen with its own title bar.
 *
 * The app is also the one component that is always there. So it is the one
 * that hears when a reply ends, in any chat, and tells the cache that the
 * list and that chat are old. A chat screen that was closed in the middle of
 * a reply could not do that.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native, Phone } from '../src/index.js'
import { RefreshChat, turnEnded } from './data.js'
import { ChatScreen } from './parts/chatScreen.js'
import { ConversationList } from './parts/conversationList.js'
import { Scheme } from './theme.js'

const Screen = Schema.Union([
  Schema.TaggedStruct('Chats', { key: Schema.String }),
  Schema.TaggedStruct('Chat', { key: Schema.String, conversationId: Schema.String }),
])

export const AppMessage = UiSchema.TaggedEnum({
  OpenedChat: { id: Schema.String },
  DismissedByPhone: { count: Schema.Number },
  ChangedScheme: { scheme: Scheme },
  EndedTurn: { conversationId: Schema.String },
  Refreshed: {},
})

export const AppProps = Schema.Struct({
  /** `ios` or `android`. */
  platform: Schema.String,
})

const AppModel = Schema.Struct({
  screens: Schema.Array(Screen),
  nextKey: Schema.Number,
  scheme: Scheme,
})

export const App = Native.component({
  name: 'App',
  props: AppProps,
  model: AppModel,
  message: AppMessage,
}).make({
  init: () => ({ screens: [{ _tag: 'Chats' as const, key: 's0' }], nextKey: 1, scheme: 'light' as const }),
  update: {
    OpenedChat: ($, { id }) =>
      // One chat at a time: a second press while the first is opening does nothing.
      $.model.screens.length > 1
        ? $.model
        : $.evolve({
            screens: [...$.model.screens, { _tag: 'Chat' as const, key: `s${$.model.nextKey}`, conversationId: id }],
            nextKey: $.model.nextKey + 1,
          }),
    // The phone closed screens by itself. The first screen always stays.
    DismissedByPhone: ($, { count }) =>
      $.evolve({ screens: $.model.screens.slice(0, Math.max(1, $.model.screens.length - Math.max(1, count))) }),
    ChangedScheme: ($, { scheme }) => $.evolve({ scheme }),
    EndedTurn: ($, { conversationId }) =>
      $.run(RefreshChat.make({ conversationId }).pipe(Command.as(AppMessage.Refreshed()))),
    Refreshed: $ => $.model,
  },
  subscriptions: () => [
    Phone.colorScheme(scheme => AppMessage.ChangedScheme({ scheme })),
    turnEnded(conversationId => AppMessage.EndedTurn({ conversationId })),
  ],
  view: (h, model) => {
    const { platform } = h.props
    const { scheme } = model
    return h.stack.testId('stack').children(
      model.screens.map(screen =>
        screen._tag === 'Chats'
          ? ConversationList(h, {
              key: screen.key,
              props: { platform, scheme },
              onEmit: { OpenedChat: ({ id }) => AppMessage.OpenedChat({ id }) },
            })
          : ChatScreen(h, {
              key: screen.key,
              props: { conversationId: screen.conversationId, platform, scheme },
              onEmit: { Dismissed: ({ count }) => AppMessage.DismissedByPhone({ count }) },
            }),
      ),
    )
  },
})
