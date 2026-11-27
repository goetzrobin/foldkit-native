# State machines in Effect Chat

## In plain words

Some parts of an app can be in one of a few modes, and only some moves
between the modes make sense. A reply is waiting, or thinking, or being
written, or done. A voice note is loading, or playing, or paused. Words
must not be added to a reply after you pressed Stop. A pause must not be
taken twice.

A state machine is a way to write that down in one place: a list of the
modes ("states"), a list of the things that can happen ("events"), and one
rule for each pair that is allowed. Anything with no rule is ignored. The
list of rules is short enough to read, and a test can go through all of it.

Effect Chat now has two state machines. They are built in two different
ways on purpose, so the two ways can be compared in a real app.

1. **The reply.** Its rules run inside the reply's own row on screen. The
   row keeps the state. When the row goes, the state goes.
2. **The audio player.** Its rules run on their own, apart from every
   screen. A voice note you start in a chat goes on playing when you go
   back to the list. A small bar ("mini player") on the list and in every
   chat shows the note and can pause it.

There is also one timeline for the whole app. It lists what the screens did
and what the player did, in the order it happened, with one set of numbers.
A recorded timeline can be run again ("replay") to see whether the app ends
in the same place. That is how a bug seen on a phone can be looked at later
on a desk.

Both machines are written with a library called effect-machine, version
0.32.1.

What we know: 386 tests pass on a simulated phone, on two builds of the
engine. The app bundles for iPhone and Android with the library in it.

What we do not know: anything only a real phone can show. Nobody has run
this on one. `apps/eui-chat/README.md` has seven yes or no checks to do on
an iPhone. The app does not have to be built again: the library is
JavaScript only.

## The two forms, side by side

| | The reply | The audio player |
|---|---|---|
| The rules | `chat/machines/reply.ts` | `chat/machines/player.ts` |
| Where the state is kept | In the Model of the reply's row | In an actor that the app starts once |
| Who runs the rules | The row's own `update`, one step per Message | The actor, one step per event, in the order events arrive |
| When it ends | When the row leaves the screen | When the app closes |
| How a screen changes it | It is the screen. A Message arrives and `update` asks the rules | It sends an event through a Command, and names itself as the sender |
| How a screen sees it | It reads its own Model | It listens, and each step it hears becomes a Message |
| How many screens can see it | One | Any number. Today three kinds: the note's row, the chip above the composer, the mini player |
| What the dev tools show | Every state change as the result of one Message, on the row's own line | The actor has no line of its own. Every step shows as a Message on each listener's line |
| How the rules are tested | A table of every rule, and every pair with no rule | The same |
| How the rest is tested | The row's `update` alone, Messages in and Commands out | The actor with pretend audio, then the screens on the simulated phone |
| Needs a service | No | Yes: `Player`, provided where the app starts |
| Can be replayed from the screens' log alone | Yes | No. It needs the actor's own record too |

### When to choose which

Put the rules inside the screen when one screen owns the thing and it
should end with that screen. It is the smaller form. There is nothing to
provide, nothing to listen to, and the dev tools and replay work with no
extra code.

Use an actor when the thing must go on after its screen has closed, or when
several screens must see and change the same thing. It needs more: a
service, a Command, a Subscription, a record of its own, and extra work to
get it into the timeline.

## Form 1: the reply

The reply's modes were tracked by hand before: a status, a connection flag,
a count of lost connections, and a few lines in the view that worked out
"thinking" and "gave up" from them. The machine has nine states.

| State | Meaning |
|---|---|
| `Waiting` | The row knows a reply is coming and has heard nothing yet |
| `Thinking` | The server has started. No words yet |
| `Streaming` | Words are arriving |
| `Reconnecting` | The connection dropped. The row has asked for the rest and waits. It counts the drops in a row |
| `Lost` | It dropped too often. A Reconnect button shows |
| `Gone` | The server has forgotten the reply. The saved copy has its end |
| `Done`, `Stopped`, `Failed` | The reply has ended |

There are ten events and thirty rules. Nine states times ten events is
ninety pairs, so sixty pairs have no rule and are ignored.

How the row uses it (`chat/parts/replyStream.ts`):

- The Model has a field `reply`, which is the machine's state.
- Each Message is turned into one event. A bundle of words is `Words`. A
  lost connection is `LostConnection`. A press on Try again is `TryAgain`.
- `update` asks the rules for the next state and stores it. If there is no
  rule, `update` returns the Model it was given and starts no Command.
- The view asks the state what it may draw (`allowed`): the Thinking label,
  the Reconnect line, the word Stopped, the failure and Try again, the Copy
  and Share buttons.

Cases that were close to a bug, each with a test now. None of them could
be made to happen by tapping, because the layer under the row or the view
happened to prevent it. The row's own code did not.

- Words that arrive after Stop. The old code would have added them to the
  text. Now they are ignored.
- Try again while the reply is still being written. The button is not
  drawn then, but the Message can still arrive, from the dev tools or a
  late press. The old code told the chat to write again. Now nothing
  happens.
- Reconnect while the connection is fine. The old code asked for a second
  connection. Now nothing happens.
- A lost connection after the reply has ended asks for nothing. This one
  was right before, and has a test now.

One thing the machine does not hold: the words themselves. They are in the
Model beside the state (`turn`). The row adds to them only when the machine
took the event.

A saved reply that has ended is drawn from its saved status, not from the
live state. `fromSaved` turns that status into a machine state, so the view
has one way of asking what to draw.

## Form 2: the audio player

Five states: `Stopped`, `Loading`, `Playing`, `Paused`, `Failed`. Eight
events: four from the screens (`Play`, `Pause`, `Resume`, `Stop`) and four
from the phone's audio (`AudioReady`, `Position`, `Finished`,
`AudioFailed`). Seventeen rules. Five times eight is forty pairs, so
twenty three are ignored.

Two more things are ignored even though a rule exists. An answer from the
phone about a note that is no longer the current one changes nothing: a
late "finished" for the first note must not stop the second. And a position
the player already has changes nothing.

### The actor

`chat/machines/playerActor.ts` runs the rules as an actor. An actor takes
events one at a time, in the order they arrive, and keeps the state itself.

The `Player` service has:

- `send(event)`: gives the actor an event.
- `latest()`: the last step that changed the state.
- `listen(listener)` and `steps`: every later step that changes the state.
- `log()`: the actor's own record of every event it received.
- `state()`: the state right now.

When a step changes the state, the service tells the phone's audio what to
do: load and play, pause, go on, or let go. The phone's answers come back
as events from the sender `audio`. The audio is the existing player service
of the host layer (`packages/native/src/host/device/player.ts`).

### How it is provided, and how long it lasts

`Player.Live` is a Layer. The actor starts when the Layer is built and
stops when the Layer closes. So where the Layer is provided decides how
long the player lasts. Nothing in the player's own code decides it.

- **In the app** it is provided once, in `chatServices` in
  `chat/start.ts`, next to the server data and the phone Commands. That
  Layer is built when the app starts and closed when the app stops. No
  screen makes the player, so it is still there when a screen has gone.
- **Around one screen** the same Layer can be provided with Effect UI's
  `Component.provide(Screen, layer, { local: true })`. Each instance of the
  screen then has a player of its own, and it stops when the screen goes.
  The app does not do this. `test/playerScoped.test.ts` shows it works.
- **In a test** the audio under the Layer is the pretend phone
  (`Phone.Device.makeTest()`). The test moves the pretend sound on with
  `device.audio.advance(1000)`.
- **In replay** the actor is made with no audio at all
  (`makePlayer({ audio: 'none' })`).

### A step

Every step tells the whole story:

```
{
  seq: 181,                                  the number from the shared clock
  before: { _tag: 'Playing', note, positionMs: 0 },
  event:  { _tag: 'Pause', by: { name: 'mini-bar', id: 'list#1' } },
  after:  { _tag: 'Paused', note, positionMs: 0 },
  changed: true                              false for an event that was ignored
}
```

Who sent the event travels inside the event, as `by`. It has a short name
(`voice-row`, `mini-bar`, `composer`, `audio`) and an id the sender makes
up. A screen makes its id from its own place and a count it keeps in its
Model, such as `list#1` for the first event from the mini player on the
list. With that id a sender can find its own event again in a timeline.

A listener puts the whole step into a Message (`HeardPlayer`). So the dev
tools show, on the listener's own line, what the player was, what happened,
who asked, and what the player is now. A listener that arrives late hears
the last step first. That is how a chat opened again shows Paused at once.

Listeners are told only of steps that changed the state. Ignored events are
in the actor's record and nowhere else.

### The three listeners

| Listener | File | What it sends |
|---|---|---|
| A voice note's row in a chat | `chat/parts/messageRow.ts` | Play, Pause, Resume |
| The mini player, on the list and in chats | `chat/parts/miniPlayer.ts` | Pause, Resume, Stop |
| The chip above the composer | `chat/parts/composer.ts` | Play, Stop |

`chat/playback.ts` holds what they share: the Command `SendToPlayer` and
the Subscription `heardPlayer`.

For a row to play a note after it was sent, the message now keeps where the
note's file is on the phone (`uri` on an attachment). That field is new and
optional. A note sent before this change has none, and its row has no play
button.

## One timeline

The screens and the player each keep their own record. Effect UI's log
holds what the screens did. `Player.log()` holds what the player did.
Neither knows about the other.

**The shared clock** (`chat/clock.ts`) joins them. It is one counter,
provided as a service. The player takes a number from it for every event it
handles. A small reader of Effect UI's log (`makeRecorder` in
`chat/timeline.ts`) takes a number from the same counter for every entry.

We looked at using Effect UI's own numbers. They do not suffice. Its `seq`
counts only its own entries, so the player's steps would have no place in
it. Its times are whole milliseconds, and many entries share one. So one
counter numbers both. Effect UI's `seq` and `causedBy` are kept on each
entry as they are, and still say which Message caused which.

**The merged timeline** is `Timeline.merge(screens, playerLog)`: one list,
lowest number first. `Timeline.lines` writes it for a person. This is a
real one, from a test: a note is paused from the mini player on the list.

```
179  MiniPlayer  PressedToggle, sends Pause to the player
181  player  Playing to Paused, on Pause by mini-bar
182  MiniPlayer  Sent
184  MiniPlayer  HeardPlayer, step 181
```

Numbers are missing where the log has entries that are not Messages, such
as a Command starting.

## Replay

`replay` in `chat/replay.ts` takes a merged timeline and runs it again.
Nothing real takes part. No server is asked and no sound is played. What
the server and the phone once answered is in the timeline already, as the
Messages and events that followed, and those are fed back too.

- **The player.** A new actor starts from `Stopped`, with no audio. Every
  event in its record is sent again, in order, each under its old number.
  Each step is held against the recorded one. The first that differs is
  reported.
- **The screens.** Each screen is run again by Effect UI's own
  `Story.fromLog`. It starts from the screen's first recorded state and
  gives `update` every recorded Message, with the props and server data it
  saw then. Commands are compared and never run. The first Message that
  gives another result is reported.

The player's events are fed in the order of the merged list. The screens
are run one after the other, each from its own entries. That gives the same
result as running them in merged order, because a screen's entries hold
everything it saw.

The three tests, in `test/replay.test.ts`:

| Test | What it shows |
|---|---|
| (a) a recorded session, run again, ends with every screen and the player where they were | Start a chat, send a voice note, play it, go back, pause from the bar, return. After replay, all nine kinds of component have the Model they ended with, and the player is Paused at the same place. A second test does the same from a timeline written to JSON and read back |
| (b) a fault in the player rules shows up | The same timeline with rules in which Pause does nothing. The replay ends Playing where the recording ended Paused, and names the step: the Pause from `mini-bar`, `list#1` |
| (c) the limit: the screens log alone brings back the screens and not the player | With the player's items left out, every screen still ends the same. The player is left at `Stopped`. The real one ended Paused |

Test (c) is the difference between the two forms. The reply, whose state is in a screen,
comes back from the screens' log alone. The player does not.

## Getting a timeline off a phone

In a development build, Settings has a row **Copy timeline**. It puts the
merged timeline on the clipboard as JSON, and the list says "Timeline
copied: 203 entries." Paste it into a message or a file. `fromJson` in
`chat/timelineFile.ts` reads it, and `replay` takes what it reads.

A timeline of a short session is about 150 KB. The app keeps the last 3,000
log entries of the screens and the last 2,000 events of the player.

A release build does not record the screens and has no such row. The
code that records and writes the JSON is in `chat/timelineFile.ts`, which
the app loads only inside `if (__DEV__)`, as it loads the dev tools.

We did not send the timeline over the dev tools connection. That connection
answers four fixed questions that Effect UI's dev tools server asks. A new
question would need a change in that server.

## Dev tools

Can the dev tools show the actor on a line of its own? **No.** Effect UI's
log takes entries only from components. Every entry names a component and
its place in the tree, and its values are sent through that component's
Schemas. The runtime gives each entry its number, and the documentation of
the log says app code cannot write entries. An entry from something that is
not a component would have none of this.

What you see: every step of the player as a `HeardPlayer` Message on each
listener's line. The mini player on the list is always there, under any
chat, so its line shows every step from start to end.

The reply needs nothing extra. Its state is in its row's Model, and each
change shows as the result of one Message.

## What the library gave us, and what we wrote

From effect-machine 0.32.1:

| Used | For |
|---|---|
| `State` and `Event` | The states and events as Effect Schemas, with a constructor for each and the typed checks `$is` and `$match` |
| `Machine.make(...).on(...)` | The rules |
| `Machine.definition` | The list of which state has a rule for which event. The tests use it to prove the table of rules is complete |
| `Machine.replay` | One step with no actor. See below |
| `Machine.spawn`, `actor.start`, `actor.call`, `actor.client` | The player as an actor |
| `Machine.scoped` | Stops the actor when its Layer closes |
| The `inspect` hook | Reports each event the actor takes and each transition it makes. The actor's record, its numbers and its listeners are built on it |

Written by us:

- **One step with no actor** (`chat/machines/step.ts`, 44 lines). The
  library has no function that takes a state and an event and gives the
  next state at once. Its public way is `Machine.replay`, which answers
  with an Effect. Our rules are plain functions, so that Effect finishes at
  once, and `step` reads it with `Effect.runSync`. The rules stay in the
  machine. One step takes about 0.03 ms on a laptop.
- **The step with its story, the shared clock, the record.** The hook gives
  the state before, the event and the state after. The number and the
  record are ours.
- **Who sent it.** The library has no notion of a sender. It is a field on
  every event.
- **Driving the sound.** The service does it after each step. The library
  can run work that belongs to a state (`spawn`, `task`). We did not use
  it, so that the rules file needs nothing from the phone and replay can
  run with no audio.
- **The Command, the Subscription, the merged timeline and replay.**

Not used:

- **Persistence** (`lifecycle.recovery`, `lifecycle.durability`). The
  durability hook is called only after a transition, so events that were
  ignored would be missing from the record. The inspect hook sees every
  event.
- **Slots.** Version 0.32.1 has none. The word appears once in its types,
  about something else.
- Supervision, the actor system, `effect-machine/atom`,
  `effect-machine/cluster`.

Effect UI has a way for a component to share state with the components
below it (`shares`, with `reads` and `$.send` on the reading side). An
owner with `shares` is a component, so it is there only while its place in
the tree is. We did not use it: the player must still be there when every
screen that used it has gone.

## Does the library run on a phone

Nothing here ran on a device. What could be done was done.

- `expo export` for iOS and Android succeeds with the library in the
  bundle. The phone's JavaScript engine (Hermes) compiled it.
- The bundle grew from 8,135,978 to 8,522,973 bytes on iOS and from
  8,141,327 to 8,528,406 bytes on Android. That is 387 KB more, or 4.8
  percent. The iOS bundle has 24 more files in it: 16 of the library and 8
  of ours. Effect itself was in the bundle already, and there is still one
  copy of it.
- No native code was added. An app built before this change only needs
  `npm install` and a reload.

The library's source was read for things Hermes or React Native lack:

| Looked for | Found |
|---|---|
| `structuredClone`, `crypto.randomUUID`, `TextDecoder`, `TextEncoder` | None |
| Node built-ins, `require`, `process` | None |
| `Symbol.asyncDispose`, `Symbol.dispose`, `using` | None |
| `WeakRef`, `FinalizationRegistry` | None |
| `queueMicrotask`, `setImmediate`, `performance`, `globalThis` | None |
| Private class fields (`#name`) | `dist/machine.js`, in the `Machine` class. Our code reaches it. Metro rewrites these for Hermes, and the export compiled |
| `Array.prototype.at` | `dist/internal/runtime.js` and `dist/internal/transition.js`. Our code reaches it. Hermes has it |
| `WeakMap` | `dist/actor.js`, `dist/schema.js`, `dist/internal/inspection.js`. Our code reaches it. Hermes has it |
| BigInt (`1000000n`) | `dist/inspection.js`, in `tracingInspector`. Our code does not call it. Hermes has BigInt |
| `??=` | `dist/atom.js`. Not loaded: we do not import `effect-machine/atom` |

## Sizes

| File | Lines |
|---|---|
| `chat/machines/reply.ts`, the reply's rules | 164 |
| `chat/parts/replyStream.ts`, the row that uses them | 385 (333 before) |
| `chat/machines/player.ts`, the player's rules | 147 |
| `chat/machines/playerActor.ts`, the actor and its service | 202 |
| `chat/playback.ts`, the Command and the Subscription | 80 |
| `chat/parts/miniPlayer.ts`, the mini player | 139 |
| `chat/parts/messageRow.ts`, a message's row with its play button | 159 (74 before) |
| `chat/parts/composer.ts`, the composer | 561 (535 before) |
| `chat/machines/step.ts`, one step with no actor | 44 |
| `chat/clock.ts`, the shared clock | 38 |
| `chat/timeline.ts`, the merged timeline | 146 |
| `chat/timelineFile.ts`, the timeline as JSON, for development builds | 79 |
| `chat/replay.ts`, replay | 127 |

Tests added: 102. The rules of the two machines have 66, the reply's row
10, the actor 10, the player on the simulated phone 7, the player around
one screen 1, replay and the timeline's way out of the app 7, and one more boundary
check.

## What does not work, and what was not checked

- **Nothing was run on a phone.** Real sound, the audio session, the
  mini player's look and its place above the home indicator are all
  unchecked.
- **The mini player's place.** On the list it is drawn over the bottom of
  the list. In a chat it is just above the composer. On an iPhone with Liquid
  Glass it may need more room or another colour.
- **Two players over one phone.** A phone has one audio player. If the
  `Player` Layer is provided around two screens, each has its own state,
  and both give orders to the same sound. One stopping lets go of the other's note.
  The test for this gives each screen's player the same pretend phone and
  plays one note at a time. The app has one player and does not meet this.
- **A position arrives before "ready".** The pretend phone reports where
  the sound is before it reports that the sound has started. The player is
  still `Loading` then and ignores that report. It is in the record as
  ignored. A real phone may or may not do the same.
- **A note sent before this change cannot be played from its row.** Its
  message does not hold where the file is.
- **The file of a note may be gone.** A recording is in the phone's cache.
  If the phone has cleared it, Play ends in `Failed`, and the mini player
  says "Could not play".
- **Replay does not check the drawing.** It checks every Model and every
  Command that was asked for. It draws nothing.
- **Replay needs a timeline from the first entry.** The app keeps the last
  3,000 entries. In a longer session the oldest are gone, and a screen is
  then replayed from the oldest entry that is left. The player's replay
  starts from `Stopped`, so with a cut record it can report a difference
  that is not a fault.
- **Fold Chat's own tests were not run.** `Attachment` in the host layer
  got one optional field. Fold Chat reads only the three fields it had.
- **Effect UI's dev tools page was not opened.** The message log it reads
  was checked in tests.

## How to check

```
cd packages/effect-ui-native
npm install
NG_NATIVE_DIR=<an ng-native checkout> npx vitest run
# and on the engine the apps install:
FABRIC_ENTRY=<repo>/apps/showcase/node_modules/@ng-native/fabric/dist/index.js \
  NG_NATIVE_DIR=<an ng-native checkout> npx vitest run

cd ../../apps/eui-chat
npm install
npx tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform ios --platform android --output-dir /tmp/eui-chat-export
```

Each new test was seen to fail once. Most were written before the code.
For the others, the code was broken on purpose:

| Broken on purpose | Test that went red |
|---|---|
| Words allowed after Stop, and one more drop allowed before giving up | Four tests of the reply's rules |
| Pause loses the place, and a late "finished" stops any note | Two tests of the player's rules |
| The actor does not tell the phone to pause | "pause and resume reach the phone" |
| A rule that returns the same state counts as a change | "an answer about the note before is in the record as ignored" |
| A late listener is not told the last step | "its row says Paused when the chat is opened again" |
| The row sends Stop where it should send Pause | Two tests on the simulated phone |
| The Layer around a screen is shared, not one per screen | "each screen has its own player" |
| Replay gives the events new numbers | Tests (a) and (b) |
| The recorder takes the log away from the dev tools | "the recorder reads the log beside the dev tools" |
