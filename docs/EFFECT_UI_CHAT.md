# Effect Chat

## In plain words

Fold Chat is our finished chat app. It is written in Foldkit. Effect Chat is
the same app written again in Effect UI, the framework that replaces
Foldkit. It draws with the phone's own views, and React draws nothing.

The work is cut into three steps. This is step 1.

**Step 1, done here.** You can see your chats in a list, start a new one,
open one and read it, and send a message. The reply is written a few words
at a time, as in Fold Chat, by the same pretend AI inside the app.

**Step 2, next.** How the chat moves: the text field moving with the keyboard,
your question staying in place after Send, the list following a growing
reply, the button that scrolls to the end.

**Step 3, after that.** Everything you reach by holding or swiping: menus,
sheets, delete, rename, settings, voice notes.

What is new, and cannot be seen, is how the app gets its data. In Fold Chat
we wrote that part ourselves: a screen that saves something announces a
topic, and every screen that named the topic loads its data again. Effect UI
has this built in, and it is called Query. Effect Chat uses Query and has
none of our own code for it.

What we know: 78 tests pass on a simulated phone, on two builds of the
engine. The app bundles for iPhone and Android.

What we do not know: anything only a real phone can show. Nobody has run the
app on one. `apps/eui-chat/README.md` has the build steps and twelve yes or
no checks.

## What step 1 built

| What | Where |
|---|---|
| Query on the phone: tells the cache when the app is in front and when the phone is online | `packages/effect-ui-native/src/NativeQuery.ts` |
| A "Server state" screen in the playground: a list from a pretend server, add, delete at once, a save that fails | `packages/effect-ui-native/playground/serverState.ts` |
| The Effect Chat program: the app and six parts | `packages/effect-ui-native/chat/` |
| The Effect Chat app | `apps/eui-chat/` |
| Tests: 8 for Query, 16 for the chat, 1 more boundary check | `packages/effect-ui-native/test/serverState.test.ts`, `chat.test.ts`, `boundary.test.ts` |

The program is about 1,500 lines, with 460 lines of tests.

### The parts

| Part | Its state | Its data |
|---|---|---|
| App (`app.ts`) | the stack of screens, light or dark | hears when a reply ends, in any chat |
| List of chats (`parts/conversationList.ts`) | "a chat is being made" | the `ListConversations` query |
| Chat screen (`parts/chatScreen.ts`) | "sending", the reply just started | the `GetConversation` query |
| Transcript (`parts/transcript.ts`) | which rows are drawn | rows, handed down as props |
| Message row (`parts/messageRow.ts`) | none | props |
| Reply stream (`parts/replyStream.ts`) | the reply being written | the reply's stream |
| Composer (`parts/composer.ts`) | the draft | none |

The list of chats and the chat screen each draw a whole native screen, with
its own title bar, and hand that one screen to the app's stack. The
playground lifted every screen into the app component. This is tidier, and
the simulated phone shows the screens sitting directly in the stack.

### How the data moves

- **Reading.** A part names a query. Effect UI loads it when the part
  appears, keeps it, and hands the part what it holds: nothing yet, the
  data, or a failure.
- **New chat.** The `CreateConversation` Command says two things about the
  cache: the list is old afterwards (`invalidates`), and the new chat is
  empty (`writes`). So the list loads again by itself, and the new chat
  opens with nothing to load.
- **Send.** The `SendMessage` Command says what the chat looks like with the
  new message in it (`optimistic`). The cache shows that from the moment the
  Command is issued. If the server refuses, the message comes off again.
- **The reply.** A reply is not a query. It is a stream of numbered events,
  kept by the host's turn keeper. The reply's row reads it through a
  Subscription, in bundles of 32 ms, and keeps it in its own Model. If the
  connection drops, the row asks for "everything after event 41" after 0.25,
  0.5, 1 and 2 seconds, and offers a Reconnect button after four tries.
  Coming back to the app during a reply asks again at once.
- **When a reply ends.** The turn keeper says so. The app component hears
  it and runs `RefreshChat`, a Command that asks the server for nothing and
  only says: the list and this chat are old. The app hears it, and not the
  chat screen, because the chat screen may have been closed by then.

There is no sync bus. A test follows every import of the chat program, to
any depth, and fails if one leads to `host/serverState`.

### One row, start to end

A row must not be made twice, or the phone would draw it twice and the text
would blink. So each row keeps one key for its whole life.

- Your message is keyed by an id the app makes when you send. The server
  keeps that id on the saved message. The row is the same one before and
  after it is saved.
- A reply is keyed by the id the server gives it when it starts. While the
  saved copy says "being written", the row shows the live text. When the
  saved copy is finished, the row shows that. By then both are the same
  words, in the same native Markdown view.

A test holds the native views of both rows in the middle of a reply and
checks they are the same views at the end.

## Reused from the host layer, unchanged

All of it is under `packages/native/src/host`.

- `aiChat/wire.ts`: the requests and the reply events. One change: see
  below.
- `aiChat/server.ts`, `aiChat/replies.ts`: the pretend server and what it
  says.
- `aiChat/transport.ts`: the cable inside the app, and the RPC client.
- From the client: `TurnKeeper`, `toUpdates`, `TurnUpdate`, `LiveTurn`,
  `LiveTurnOps`, `reconnectDelayMs`, `MAX_RECONNECTS`, `ChatError`.
- `device/*`: the phone's services, as in the playground.
- `markdown/*`: the native Markdown view, its styles and themes.
- `navigation/views.ts`: the stack, screens and title bar.
- `list/window.ts`: the arithmetic of the long list.

## Changed in the host layer

Three small changes, all inside `host/aiChat`. Fold Chat's own tests for
this code still pass (68 tests in five files).

1. **`turns.ts` is new.** The live turn code was in `client.ts`, next to the
   atoms client, and `client.ts` imports `host/serverState`. It moved to
   `turns.ts`, which imports none of it. `client.ts` re-exports everything,
   so nothing that used it changed.
2. **The turn keeper takes a function.** It used to announce two sync topics
   when a turn started or ended. Now `turnKeeperLayerWith(announcer)` calls
   whatever it is given. Fold Chat gives it the sync topics. Effect Chat
   gives it `TurnNews`. The keeper also gained `has(turnId)`, and
   `followUpdates` holds the 32 ms bundling that both clients share.
3. **`topics.ts` is new.** The sync topics were at the bottom of `wire.ts`,
   which made the wire import `host/serverState`. They moved to their own
   file.

Not used from the host: `Pending`, `PendingOps` and `transcript`. Query's
optimistic patch does the job of `Pending`, and the chat screen builds its
rows from the query in twenty lines.

## Effect UI's Query and Command: what we found

**Query worked as its documentation says.** Nothing had to be worked around
in `NativeQuery`, and Effect UI itself was not changed. The vendored package
already holds Query, so it was not built again.

The case we were asked to look at hardest: an invalidation that happens
while no screen is watching the entry. Our own atoms layer lost those with
Effect 4.1.0. Effect UI's cache does not. Two tests cover it. In one, a
small app closes its only screen, a Command invalidates the query, and the
screen opens again: it loads again and never draws the old value as if it
were new. In the other, a chat is closed in the middle of a reply and opened
after the reply has ended: the half-written copy the cache still holds is
never drawn.

Smaller findings, none of them a fault:

1. **The app does not provide the cache.** Each mount makes its own. The
   brief for this work said to provide `Query.layer()`. That Layer is for
   plain Effect code outside a mount. What a host provides is two facts,
   `Query.Visibility` and `Query.Connectivity`, and the cache reads them
   once, when the mount starts.
2. **A query whose Layer has closed stays "loading" and says nothing.** In a
   test, `Effect.provide(layer)` closes the Layer as soon as the mount
   returns. Commands still worked. Every query stayed on its first state
   for ever, with no warning. The tests now keep their Layers built until
   the test ends (`provideForTest` in `test/support.ts`). A warning from the
   cache would have saved an hour.
3. **`Query.makeSignal` is marked internal.** A host needs a settable
   signal for the two facts. `NativeQuery` has its own, twenty lines.
4. **A Command cannot ignore a second run while the first is going.** The
   documentation says so. The parts keep a flag in the Model for it
   (`isCreating`, `isSending`).
5. **A run ends with the component that issued it.** Also documented. It is
   why the app component, which is always there, runs `RefreshChat`.
6. **`onChange` on a query** is how the chat screen learns that the saved
   chat now holds the reply. It worked as documented.

Two findings about our own host, not about Effect UI:

- `Native.NoTextChildren<Msg, R>` gives `R` the default `any`. One helper
  typed with it turned three components' requirements into `any`. Nothing
  complained until the mount, far away. The default in `src/Native.ts` is
  now `never`.
- An event that is not in the vocabulary needs a cast on `.on(...)`. The
  iPhone's own bar button reports its press as `pressHeaderBarButtonItem`.
  `chat/ui.ts` casts once. Bar buttons should become part of the vocabulary.

## Workarounds and stopgaps

1. **Room for the keyboard.** The brief said to leave the keyboard for step
   2. Without anything, the keyboard covers the text field and you type
   blind. The chat screen pads its bottom by the keyboard's height. It is
   one line in `parts/chatScreen.ts`, marked as step 1 only, and it does
   not move with the keyboard: it jumps. Step 2 replaces it.
2. **`TextDecoder` is declared by hand** in `types/globals.d.ts`, for a line
   in the host's cable that NDJSON never reaches.
3. **The Send button's arrow is the letter "↑".** Fold Chat draws its icons.
   That code is in the Foldkit binding.

## Not in step 1

Left out on purpose, with the place each will go:

- In the transcript: anchoring, following, room for the keyboard, the
  scroll button.
- In the composer: the keyboard dock, glass, Stop, voice notes, and getting
  a refused message back into the field.
- In the message row and the reply: holding for a menu, Copy, Share,
  Regenerate, the reasoning sheet, haptics, the "Thinking" shimmer.
- In the list: date headers, search, swipe to delete or rename.
- In the app: settings, the theme switch, the crash screen.

## What steps 2 and 3 need that is missing

The phone half of each is in the host layer. What is missing is the Effect
UI half.

**Step 2**

1. **Anchoring for the transcript.** `host/list/controller.ts` keeps scroll
   position, the end and the keyboard inset. It needs a Mount on the scroll
   view that runs it and reports as Messages. Open question: the controller
   keeps its own window, and `VirtualList` keeps one in the Model. Only
   one of them can own it.
2. **The keyboard dock.** `host/keyboard/dock.ts` is the controller. It
   needs a Mount, and the dock's two native views need names on `h`.
3. **A way for a parent to change a child's state.** The composer owns the
   draft. Putting a refused message back needs the chat screen to reach it.
   Either the draft moves up, or Effect UI's way to send a child a message
   is used. Not tried yet.
4. **Markdown.** `ShowMarkdown` sends text to the native view. The fade as
   words arrive and text selection are not checked.

**Step 3**

5. **Menus.** `host/menus` has the items and the native sheet. There is no
   Effect UI element for a context menu and no Command for the action
   sheet.
6. **Swipe rows.** `host/swipe` has the row behaviour as node hooks. No
   element on `h`.
7. **Sheets.** `NativeViews.sheet` exists. A sheet is a screen in the stack,
   and the app owns the stack. A part that wants a sheet has to ask the app
   for it, or draw a second stack. To be decided.
8. **More phone services as Commands.** `Phone.ts` has six. Step 3 needs the
   recorder, the player, saved voice notes, share, alert and storage. The
   host services exist. The Command classes are mechanical.
9. **Telling the phone the theme.** Fold Chat's `Appearance` service is in
   `packages/native/flagship`. It has to move to the host.
10. **Bar buttons and their menus as vocabulary.** See above.
11. **Drawn icons.** Fold Chat's icons are made of boxes, in the Foldkit
    binding. They need to move to where both apps can use them.

## What could not be checked

None of this runs on a real phone here. In particular:

- That a part's own screen slides in and swipes back as it should.
- The iPhone's bar button, and its press reaching the program.
- The large title, and the list keeping clear of it.
- The native Markdown view being fed while a reply streams.
- The bottom padding when the keyboard comes up.
- Chats being kept in the app's documents after the app closes.
- Anything on Android.

## How to check

```
cd packages/effect-ui-native
npm install
NG_NATIVE_DIR=/path/to/ng-native npx vitest run
# and on the engine the apps install:
NG_NATIVE_DIR=/path/to/ng-native FABRIC_ENTRY=/path/to/@ng-native/fabric/dist/index.js npx vitest run
npx tsc --noEmit

cd apps/eui-chat
npm install
npx tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform ios --platform android --output-dir /tmp/eui-chat-export
```

Each test was seen to fail once, with the code broken on purpose. The
defects tried: no optimistic patch, hiding a deleted row in the Model
instead of in the cache (the row flashed), no `Query.Visibility`, no
`Query.Connectivity`, a write with no `invalidates`, no bundling of reply
pieces, a message row keyed by the server's id, the app not hearing a
reply's end, a reply's end marking only the list as old, `CreateConversation`
writing nothing, no resume after a lost connection, no resume on return to
the app, a turn the keeper has not seen not being joined, and an import of
the atoms client.
