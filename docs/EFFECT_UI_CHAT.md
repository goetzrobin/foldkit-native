# Effect Chat

## In plain words

Fold Chat is our finished chat app. It is written in Foldkit. Effect Chat is
the same app written again in Effect UI, the framework that replaces
Foldkit. It draws with the phone's own views, and React draws nothing.

The work is cut into three steps. Steps 1 and 2 are done.

**Step 1, done.** You can see your chats in a list, start a new one,
open one and read it, and send a message. The reply is written a few words
at a time, as in Fold Chat, by the same pretend AI inside the app.

**Step 2, done.** How the chat moves: the text field moving with the
keyboard, your question going to the top after Send and staying there, the
list following a growing reply, the button that scrolls to the end. This is
the part that took three rounds of bug reports from a real iPhone to get
right in Fold Chat. Step 2 did not write it again. It runs the same code
that was fixed then, and has a test for each of those bugs. See "Step 2"
below.

**Step 3, next.** Everything you reach by holding or swiping: menus,
sheets, delete, rename, settings, voice notes.

What is new, and cannot be seen, is how the app gets its data. In Fold Chat
we wrote that part ourselves: a screen that saves something announces a
topic, and every screen that named the topic loads its data again. Effect UI
has this built in, and it is called Query. Effect Chat uses Query and has
none of our own code for it.

What we know: 127 tests pass on a simulated phone, on two builds of the
engine. The app bundles for iPhone and Android.

What we do not know: anything only a real phone can show. Nobody has run the
app on one. `apps/eui-chat/README.md` has the build steps, twelve yes or no
checks for step 1 and twelve for step 2. The app can show its own numbers
on screen, so a check can be answered by reading a number out.

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

## Workarounds and stopgaps of step 1

1. **Room for the keyboard.** Step 1 padded the screen by the keyboard's
   height. Step 2 took that out: the phone moves the composer now.
2. **`TextDecoder` is declared by hand** in `types/globals.d.ts`, for a line
   in the host's cable that NDJSON never reaches. Still there.
3. **The Send button's arrow was the letter "↑".** Step 2 draws it, from
   three bars, as Fold Chat does.

## Step 2: how the chat screen moves

### What it built

| What | Where |
|---|---|
| `AnchoredList`: the host's list controller, with Effect UI drawing the rows | `packages/effect-ui-native/src/AnchoredList.ts` |
| `KeyboardBar`: a bar the phone moves with the keyboard | `packages/effect-ui-native/src/KeyboardBar.ts` |
| `nodeData`: a prop that switches a host feature on for one element | `src/NativeHost.ts` |
| A scroll view's own tap, called off by a drag | `src/internal/touch.ts` |
| `focus` leaves a field alone that has the caret already | `src/NativeHost.ts` |
| The chat's part of the simulated phone | `src/testing/ChatPhone.ts` |
| The chat screen, transcript and composer on top of these | `chat/parts/` |
| Stop, as a Command | `chat/data.ts` |
| The drawn arrow and the Stop square | `chat/icons.ts` |
| Tests: 37 for the chat screen, 9 for the new modules, 3 for the arrow | `test/chatMechanics.test.ts`, `anchoredList.test.ts`, `chatIcons.test.ts` |

### The open question from step 1, answered

Step 1 asked: the host's list controller keeps its own window (which rows
are drawn), and `VirtualList` keeps one in the Model. Which one owns it?

The controller owns it. It has to: where the list is, the room under the
question, the inset and following all depend on the row heights, and the
controller is where all of that was put right on a real iPhone.

But the rows are still ordinary Effect UI child components. The controller
asks a "painter" to draw the rows it chose. Foldkit's painter builds the
rows. Ours builds nothing: it tells the transcript the window as one
Message (`PlannedWindow`), and the transcript's view draws those rows. So a
row keeps its own state, its Subscription to the reply's stream and its
place in the app's tree. `VirtualList` is not used by the chat.

What goes where:

- **Scrolling sends no Message.** The controller hears the scroll view
  straight from the engine. A Message is sent only when other rows are
  needed, or when the end comes into view or leaves it.
- **A row's height sends no Message.** The row's holder tells the
  controller directly.
- **The canvas's height is written by the painter**, in the same commit as
  the inset. The rows of a new window come one draw later.

### How each of the twelve points is met

| | Point | How |
|---|---|---|
| 1 | The phone moves the composer | `KeyboardBar` over `host/keyboard/dock.ts`. react-native-keyboard-controller's native view reports the keyboard, and React Native's animation module moves the bar. No JavaScript per frame |
| 2 | A new chat focuses once, after the push | The field has no `autoFocus`. The chat screen waits for the screen's `appear` event, or 0.7 s, and raises a number the composer watches. The composer runs the focus |
| 3 | A tap outside puts the keyboard away | A press on a row or on the list itself is a Message. The list's own press is called off when it starts to scroll |
| 4 | The 34 point strip | `restUnderBar` and `barPlace` in `host/keyboard/geometry.ts`, unchanged |
| 5 | The inset is what the composer covers | The dock tells the list the bar's height, and the list sets its bottom inset. Unchanged host code |
| 6 | Send off, then Stop | The composer's two props: `isSending`, `isReplying`. Stop runs the new `StopTurn` Command |
| 7 | The question goes to the top | The chat screen names the question (`anchorKey`). The controller's anchored end space does the rest |
| 8 | Nothing creeps | The controller holds a smaller inset back for one commit (about 48 ms). Unchanged host code |
| 9 | The round button | Drawn inside the bar the phone moves. Shown when the list says its end is out of view and it is not following |
| 10 | Following stops and starts | The controller's own. New: it waits under a finger that rests on a row (`touchList`), told by the row's `pressIn` and `pressOut` |
| 11 | A hold while a reply streams | The host's `longPress`, which already survives scrolls the program makes. Counted in the numbers strip |
| 12 | A saved chat opens at its end | The list is not drawn until the messages are here. It then opens unseen and is shown once it is at its end |

### Reused from the host layer, unchanged

- `list/controller.ts` (but see "Changed"), `list/end.ts`, `list/window.ts`.
- `keyboard/dock.ts`, `keyboard/geometry.ts`, `keyboard/detect.ts`,
  `keyboard/drive.ts`.
- `chat/chatScroll.ts` and `chat/vendor/kbc/*`: the keyboard arithmetic
  taken from react-native-keyboard-controller.
- `fabric/registry.ts`: the new modules register their node hooks there.
- From Fold Chat's tests: `test/support/scrollPhone.ts` (the scroll view
  that behaves as UIKit's does) and `test/support/nativeAnimated.ts`. Both
  suites use the one copy.

`worklets/hold.ts` (the phone's own long press recogniser) is not used yet.
The host's `longPress` was enough for counting a hold in tests. Step 3
should attach it for the menu, as Fold Chat does.

### Changed in the host layer

Two changes, both in `list/controller.ts`. Fold Chat's own tests still pass
(94 in `test/flagship`, 216 in the six other files that cover lists and the
keyboard).

1. **`touchList(id, isTouched)` is new.** A list that follows its end stays
   where it is while a finger rests on a row. The phone reports a drag by
   itself, but not a finger that only rests.
2. **A release at the end keeps following.** When a finger lets go, the
   list waits 80 ms to learn whether a fling follows. It used to decide
   "at the end or not" after that wait. A reply that grew a line in those
   80 ms made the answer "no", and following did not start. Fold Chat's
   tests run on a stopped clock and never saw it. These tests run in real
   time and did. Now the answer is taken when the finger lets go.

`test/support/scrollPhone.ts` lost its import of the Foldkit test phone.

### Workarounds in step 2

1. **Rows come one draw after their window.** The controller chooses the
   rows and draws in one go. Here the rows arrive with the next draw, a
   moment later in the same turn of JavaScript. The inset and the content
   height do not wait. On the simulated phone this changes nothing. On a
   real one it may show as a blank strip for one frame in a hard fling.
2. **The canvas's style is written around Effect UI.** The painter sets it
   on the engine directly. The view gives that element no style, so the two
   never disagree.
3. **Host features are found through a prop.** `nodeData` carries a key the
   host's node hooks look for. It is how the list and the bar start before
   the commit that shows them. A Mount would start a moment after the
   commit, and could miss the phone's first layout report.
4. **Two Commands may not run in the order they were issued.** A tap on a
   row issues "finger down" and "finger up" within a moment. Each carries a
   count from the Model, and the list drops one that arrives late. Without
   it, a list could be left waiting for a finger that has gone.
5. **A parent cannot tell a child to act.** A ref only resolves inside the
   component that owns the element. So the chat screen cannot focus the
   composer's field. It raises a number in the composer's props, and the
   composer has a Subscription keyed by that number that sends itself one
   Message. It works. It is not pretty.
6. **Events that are not in the vocabulary are cast.** The list's own
   events (`listWindowChanged`, `listAtEndChanged`, `listFollowChanged`)
   are cast once, inside `AnchoredList.view`.
7. **The first question of a new chat sits at 0, not at 16.** There is
   nothing above it to scroll away. Fold Chat does the same.

### Where this differs from the brief

- **Send puts the keyboard away.** The brief said a tap on a button inside
  the composer does not put the keyboard away. That holds for the round
  button to the end, Stop, the field and an empty Send. Send with text does
  put it away, on purpose, because Fold Chat does. One line in
  `chatScreen.ts` (`Phone.DismissKeyboard`) to change it.
- **`VirtualList`'s `onDrag` is not used.** The brief named it for
  following. The host's controller hears drags from the engine itself, and
  using both would have two owners for one fact. `pressIn` and `pressOut`
  are used, for the resting finger.

### Not in step 2

- Glass behind the composer. It has the plain surface colour.
- The round button's fade, and the cross fade between Send and Stop.
  There is no motion binding for Effect UI yet.
- Haptics on Send and Stop.
- A refused message going back into the field. The notice shows, the
  message comes off, and the text is lost.
- The offline line.

## What step 3 needs that is missing

Step 3 is the context menu, the settings and reasoning sheets, delete,
rename, and voice notes with speech recognition.

1. **Menus.** `host/menus` has the items and the native sheet. There is no
   Effect UI element for a context menu and no Command for the action
   sheet. The hold is ready: `HeldRow` in `transcript.ts` is where the menu
   opens. With the keyboard up, Fold Chat puts the keyboard away first and
   opens the menu 60 ms later, so the sheet is not under the keyboard.
2. **The phone's own long press.** `host/worklets/hold.ts`, through
   `NativeMount.TrackHold`. Fold Chat uses it first and the JavaScript hold
   as the backup.
3. **Sheets.** `NativeViews.sheet` exists. A sheet is a screen in the stack,
   and the app owns the stack. A part that wants a sheet has to ask the app
   for it. The numbers switch already goes that way (`ToggledNumbers`).
4. **Swipe rows**, for delete and rename in the list. `host/swipe` has the
   row behaviour as node hooks. It can be switched on with `nodeData`, as
   the list and the bar are.
5. **More phone services as Commands.** `Phone.ts` has six. Step 3 needs the
   recorder, the player, saved voice notes, share, alert and storage. The
   host services exist. Speech recognition does not exist anywhere yet:
   Fold Chat sends a voice note with a line of text in place of a
   transcript.
6. **A way to put text into the composer.** A refused message and a voice
   note's transcript both need it. Either the draft moves up to the chat
   screen, or the number-in-props trick is used again.
7. **Rename and delete as Commands** with `invalidates`, like
   `CreateConversation`.
8. **Telling the phone the theme.** Fold Chat's `Appearance` service is in
   `packages/native/flagship`. It has to move to the host.
9. **Bar buttons and their menus as vocabulary.** The cast in `chat/ui.ts`
   is still there.
10. **Motion.** `host/motion` has enter and exit animations as node hooks.
11. **Markdown.** The fade as words arrive and text selection are still not
    checked.

## What could not be checked

None of this runs on a real phone here. In particular:

- That a part's own screen slides in and swipes back as it should.
- The iPhone's bar button, and its press reaching the program.
- The large title, and the list keeping clear of it.
- The native Markdown view being fed while a reply streams.
- Everything in step 2 that is about movement: the composer travelling
  with the keyboard, the question gliding to the top, the list following,
  nothing jumping when a chat opens. The tests check the numbers the phone
  is given. They cannot see the movement.
- That react-native-keyboard-controller's native view is found in the build
  and reports the keyboard. If it is not, the app falls back to padding,
  and the numbers strip says `keyboard padded`.
- That the title in the bar takes a hold (the numbers switch), and still
  looks like the phone's own title.
- That a row's first layout reaches the list on a real phone as it does on
  the simulated one.
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

Each test of step 1 was seen to fail once, with the code broken on purpose.
The defects tried: no optimistic patch, hiding a deleted row in the Model
instead of in the cache (the row flashed), no `Query.Visibility`, no
`Query.Connectivity`, a write with no `invalidates`, no bundling of reply
pieces, a message row keyed by the server's id, the app not hearing a
reply's end, a reply's end marking only the list as old, `CreateConversation`
writing nothing, no resume after a lost connection, no resume on return to
the app, a turn the keeper has not seen not being joined, and an import of
the atoms client.

Each test of step 2 was seen to fail once too. The defects tried, by point:

1. The step 1 padding put back. On Android, the bar not padded.
2. The caret asked for during the push. No timer for a phone that never
   says the screen appeared. A saved chat asking for the caret. A question
   sent before the push was over still asking. A field that has the caret
   asked again.
3. A tap on a message doing nothing. A drag counted as a tap. A button in
   the bar putting the keyboard away. A tap asking with the keyboard down.
4. The strip under the composer read from the first measurement only.
5. The list given no inset.
6. Send left on while a message is on its way. Stop doing nothing.
7. No anchor. The list held by the row at the top of the screen, not by the
   question.
8. The smaller inset sent in the same commit as the taller rows.
9. The button shown only with the keyboard up. The button drawn outside the
   bar. A tap that does not scroll.
10. The list moving under a resting finger. No following after coming back
    to the end. Following kept after a drag away. Following kept by a new
    question. Following decided 80 ms after the finger let go.
11. On the published engine: a press called off by a scroll the program
    made.
12. The list not hidden while it opens. The list drawn before the messages
    are here.

And for the new modules: the numbers line not written by the list, row
heights not reaching the controller, a late "finger down" not dropped, the
scroll view's content view not
announced to the host's hooks, the window told on every draw (the test does
not end), the text field not named for the keyboard's drag, and the arrow's
head drawn beside the stem.

One defect tried did not turn a test red: taking out the line that stops
following the moment a finger leaves the end. The list stops following
anyway when the finger lets go, a moment later, so nothing on screen
differs.

For a change to `packages/native/src/host`, run Fold Chat's own tests for
that code as well:

```
cd packages/native
FOLDKIT_DIR=/path/to/foldkit NG_NATIVE_DIR=/path/to/ng-native node_modules/vitest/vitest.mjs run test/flagship test/chatDock.test.ts test/chatList.test.ts test/chatInset.test.ts test/lists.test.ts test/keyboard.test.ts test/androidKeyboard.test.ts
```

The pin scenarios take a seed. `PIN_SCENARIOS=40` runs more of them and
`PIN_SEED=7` runs one again.
