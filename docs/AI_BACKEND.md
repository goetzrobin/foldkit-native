# AI backend

A pretend AI chat server that runs inside the app, and the code the app uses
to talk to it. It is built the way a real one is built, so the chat screens
made on top of it will work the same way when a real server takes its place.

The first part is for a reader who does not code. The appendix is for
engineers. The demo is "AI backend" in the showcase menu. None of this has
been seen on a real phone yet.

## Why pretend

A chat screen needs a server that answers. A real one costs money for every
question, needs a network, and answers differently each time. That makes it
hard to build a screen and hard to test one. So the app carries a small
server of its own. It knows a handful of answers and sends them back a few
letters at a time, at a speed you choose. It can also fail on purpose, so
the screen's handling of bad days can be tried on any day.

## The pieces

**The wire.** A list of everything the app and the server may say to each
other: "list my conversations", "send this message", "stop that reply", and
the small events a reply is made of. Both sides are built from this one
list, so they cannot disagree about it.

**The server.** It keeps the conversations and saves them on the phone, so
they are still there after the app closes. When a message arrives it starts
writing a reply. It picks the reply by words in the question. Some replies
think first, and the app can show the thinking. Some call a tool, such as a
weather lookup, and wait for it before answering.

**The cable.** In a real app the network sits between the app and the
server. Here both are inside the app, so a pretend cable joins them. It still
turns every message into text and back, as a network would. A mistake that
would break on a real network breaks here first.

**The client.** The part of the app that asks the server for things and
hands the answers to the screens. It keeps a copy of each conversation and
loads it again when something changes. It also gathers the pieces of a reply
as they arrive and passes them on in small bundles, so the screen is not
redrawn for every few letters.

**The demo.** A plain screen for developers. It is not the finished chat
screen. It shows the conversations, three ready-made questions, the reply as
plain text, a timed log of everything that reached the program, and switches
that make the server slow or broken.

## The life of one message

1. You press a question. It appears at once, greyed, marked "sending". The
   server has not seen it yet.
2. The client sends it down the cable as one line of text.
3. The server saves your message and starts a reply, called a turn. It
   answers with the turn's first event: "started, and the reply will be
   message m4".
4. The client tells the screen the reply has started. It also tells every
   part of the app that this conversation has changed, so its copy is
   loaded again. Your message is no longer grey: the server has it.
5. The server waits a moment, as a real model does before its first word.
6. If the question needs thought, the thinking streams first, then a line
   that says how long it took. If it needs a tool, the server says which
   tool, waits for it, and passes on the answer.
7. The reply streams, a few letters at a time. Each piece has a number, 1, 2,
   3 and so on, so none can be lost or counted twice.
8. The client gathers the pieces that arrive within about 30 milliseconds and
   hands them to the screen as one bundle. The screen is redrawn about 30
   times a second at most, however fast the server writes.
9. The last event says "finished" (or "stopped", or "failed, and why"). The
   server saves the whole reply.
10. The client says once more that the conversation changed. The saved copy
    loads, and the screen moves from the live reply to the saved one. You see
    no change.

If the connection breaks in the middle, the server keeps writing. The client
notices, waits a quarter of a second, and asks for "everything after piece
41". The reply carries on where it stopped. If you leave the app and come
back while a reply is being written, the client asks the same thing, because
a phone may close the connection in the background without saying so.

## What is pretend

- **The model.** There is none. Six replies were written by hand. The
  question's words choose one: running, train or car, weather, notes, code,
  and one for anything else.
- **The tools.** The weather and the notes are made up. The weather reply
  says so.
- **The network.** The cable is inside the app. "Drop connection" cuts it on
  purpose. A real network does this by itself.
- **The timing.** The wait before the first word, the speed, the unevenness
  and the odd pause are dials, not measurements.
- **Saving.** On a phone the conversations are saved as files in the app's
  documents. In a build without the file module they are kept in memory
  while the app runs. The demo says which on screen.

Real, and the same as a real backend would be: the wire, the RPC client and
server from Effect, the NDJSON text on the cable, the client, and how the
screens get their data.

## Trying the demo

Open "AI backend". Press New, then "Plain". Watch the log fill and the reply
grow. Then try "Thinks first" and "Calls a tool". Press Stop halfway through
a reply. Press Regenerate. Switch on "Drop connection" and ask again: the log
shows the break, the status line says it reconnected, and the reply ends
whole. Switch on "Refuse sends" and ask: your message appears, then goes,
and a red line says why. Close the demo and open it again: the conversations
are still there.

---

## Engineer's appendix

### Files

| File | What is in it |
|---|---|
| `src/aiChat/wire.ts` | Schemas, the `TurnEvent` union, errors, `AiChatRpcs`, `AiChatSync`, `applyToParts` |
| `src/aiChat/server.ts` | `makeAiServer`, `Disk` and its three makers, `SPEEDS`, `Chaos` |
| `src/aiChat/replies.ts` | `pickReply`, `tokenize`, `titleFrom`, the reply texts |
| `src/aiChat/transport.ts` | `AiChatRpcClient`, `makeInProcessLink`, `layerInProcess`, and the replacement note |
| `src/aiChat/client.ts` | `makeAiChat`, `TurnKeeper`, `TurnUpdate`, `LiveTurn`, `Pending`, `transcript` |
| `src/aiChat/index.ts` | The public API |
| `test/demos/aiBackend.ts` | The demo program |
| `test/aiBackendServer.test.ts` | The server through the real RPC client, no Foldkit |
| `test/aiBackend.test.ts` | The demo on the simulated phone, and the Model pieces |

Imports are `effect/rpc/*` and `effect/reactivity/*` from Effect 4.1.0. No new
packages.

### The wire

| Request | Answer | Errors |
|---|---|---|
| `ListConversations()` | `ConversationSummary[]`, newest first | |
| `GetConversation({ id })` | `Conversation` with `messages` and `activeTurnId` | `ConversationNotFound` |
| `CreateConversation({ title? })` | `ConversationSummary` | |
| `RenameConversation({ id, title })` | `ConversationSummary` | `ConversationNotFound`, `BadRequest` |
| `DeleteConversation({ id })` | nothing | `ConversationNotFound` |
| `SendMessage({ conversationId, text, attachments?, clientMessageId? })` | stream of `TurnEvent` | `ConversationNotFound`, `TurnInProgress`, `BadRequest` |
| `StopTurn({ turnId })` | nothing, once the stopped reply is saved | `TurnNotFound` |
| `RegenerateTurn({ conversationId })` | stream of `TurnEvent` | as `SendMessage` |
| `WatchTurn({ turnId, afterSeq })` | stream of `TurnEvent` after `afterSeq` | `TurnNotFound` |

`WatchTurn` is not in the brief. It is how a lost stream is resumed, and it is
what a real backend needs for the same reason.

Events, in order: `TurnStarted`, then optionally `ReasoningDelta...`
`ReasoningDone`, then any number of `ToolCallStarted` `ToolCallResult`
pairs, then `TextDelta...`, then exactly one of `TurnFinished { usage,
reason: 'complete' | 'stopped' }` or `TurnFailed { reason, isRetryable }`.
Every event has `seq`, from 1 without gaps within its turn.

A message is `{ id, role, parts, status, createdAt, turnId, clientMessageId,
attachments, failure, usage }`. `parts` is a list of `Text`, `Reasoning
{ text, seconds }` and `ToolCall { callId, name, input, output | null }`.
`applyToParts(parts, event)` is the one function both sides use to build a
reply from its events.

### The server

- A turn runs in a fiber forked into the handlers Layer's scope, not in the
  request's fiber. Closing a `SendMessage` stream does not stop it. Each turn
  keeps its events, so `WatchTurn` can replay them. The last 20 finished
  turns are kept.
- `StopTurn` interrupts the fiber. `onInterrupt` emits `TurnFinished` with
  `reason: 'stopped'` and saves. Closing the program does the same.
- Delays are `Effect.sleep`, so a `TestClock` drives them. `SPEEDS.slow`,
  `normal` and `fast` set the first-token wait, tokens a second (reasoning
  runs at twice that), jitter, pause chance and length, tool time, and
  request latency. The jitter is seeded (`seed`).
- Chaos: `failMidStream` sends `TurnFailed` at half the answer.
  `dropConnection` cuts the cable at a third of the answer, once per turn.
  `slowFirstToken` waits at least 4 s. `refuseSend` answers `SendMessage`
  with `BadRequest`.
- Saving: an `index` file (`{ version: 1, nextId, conversationIds }`) and one
  file per conversation, as JSON. Saved when a conversation is made, renamed
  or deleted, when a turn starts and ends, and every 40 events. On load, a
  reply still marked `streaming` was cut off by a crash: it is marked
  `stopped` with the note "The app closed while this reply was being
  written." A save that fails is counted (`diskErrors()`) and the server goes
  on from memory.
- `diskFromFiles(files)` uses the voice notes' file service. The demo uses
  `Native.filesFrom(Native.fileSystemFromGlobal(), 'ai-chat')` when the build
  has the module. `diskFromStorage(service)` uses `Phone.Storage`: on a phone
  that is the secure store, which Expo warns about above 2 KB a value, so it
  suits short chats only. `memoryDisk()` is for tests.

### The cable

`makeInProcessLink()` makes a pair of Effect RPC protocols: an
`RpcClient.Protocol` and an `RpcServer.Protocol`. Every message is encoded
with `RpcSerialization.ndjson` on one side and decoded by a separate parser on
the other. `supportsAck` is on, as on a socket, so stream chunks are
acknowledged and a slow reader slows the writer. `drop` sends a
`ClientProtocolError` to the client (every request in flight fails with
`RpcClientError`) and the connection number to the server's `disconnects`
queue. The client's next request gets a new connection number, so the server
never mixes old and new.

`layerInProcess(server, link)` builds `AiChatRpcClient` from
`RpcClient.make(AiChatRpcs)` over the client protocol, and runs
`RpcServer.layer(AiChatRpcs)` with the server's handlers over the server
protocol.

**Replacing it with a real network.** Build `AiChatRpcClient` from
`RpcClient.make(AiChatRpcs)` over `RpcClient.layerProtocolSocket` (a
WebSocket) or `RpcClient.layerProtocolHttp` with `RpcSerialization.layerNdjson`,
pass that Layer as `transport` to `makeAiChat`, and delete the server from the
app. Nothing else changes: the client, the atoms and the screens only know
`AiChatRpcClient`. On the phone, React Native's `fetch` does not stream a
response body, so streamed replies over plain HTTP would arrive all at once;
use a WebSocket, or in a prebuilt app a fetch that streams such as
react-native-nitro-fetch (or nitro-websockets). That needs a native package,
which is why this branch does not add one. The real server runs the same
`AiChatRpcs` with real handlers behind `RpcServer.layerHttp`.

### The client

```ts
const chat = makeAiChat({ transport: layerInProcess(server) })
Runtime.makeElement({ ..., resources: Layer.mergeAll(chat.layer, phoneLayer) })
```

- `chat.conversationList` and `chat.conversation(id)` are atoms with
  `AsyncResult<_, ChatError>`. They refresh on the sync topics and, being
  `Atom.swr`, on mount and on return to the app when older than 30 s. Watch
  them with `watchAtom` from `src/serverState`.
- `chat.create / rename / delete(…, onSuccess, onFailure)` are Command
  Effects that announce `chat:conversation-list-changed` (rename and delete
  also `chat:conversation-changed`).
- `chat.send(args)` and `chat.regenerate(id)` answer `TurnStart`: `Started`
  with the `TurnStarted` event once the server has saved the message, or
  `Failed` with a `ChatError`. The stream stays open in the `TurnKeeper`.
- `chat.stop(turnId, …)` and `chat.resume(turnId, delayMs, done)`.
- `chat.liveTurnEntry({ modelToTurnId, toMessage, batchMs? })` is a
  Subscription entry. It reads the `TurnKeeper`'s copy of the turn through
  `Stream.groupedWithin(4096, batchMs)` (32 ms by default) and `toUpdates`,
  which joins consecutive text pieces into one `TextBatch` and reasoning
  pieces into one `ReasoningBatch`. Other events stay one Message each.
  `toMessage(update, receivedAt)` gets the clock time for logs.

The `TurnKeeper` is a service in the client's runtime. It owns every
connection to a turn and keeps the turn's events, numbered, with repeats
dropped. It announces both topics when a turn starts and when it ends, so
the conversation and the list load again with no code in the screen. A
broken connection adds `ConnectionLost` to the turn; `WatchTurn` answering
`TurnNotFound` adds `TurnGone`.

**Reconnect rule.** On `ConnectionLost` the program calls
`chat.resume(turnId, reconnectDelayMs(lostCount))`: 250 ms, then 500, 1000,
2000, at most 4000. After `MAX_RECONNECTS` (4) in a row it stops and offers a
Reconnect button. Any event that arrives resets the count. **Background
rule.** On return to the app with a reply still being written, the program
calls `resume` at once. Resuming an open connection replaces it and repeats
nothing, so the rule needs no guess about whether the connection survived.
Both rules are in the demo's `update`, not in the client, so a screen can
choose differently.

**Model pieces.**

- `LiveTurn` (Schema) and `LiveTurnOps`: `start(started)`, `apply(maybeLive,
  update)` (skips pieces it has, by `seq`), `stopping`, `resuming`,
  `settle(maybeLive, conversation)` (drops it once the saved copy is
  finished), `isStreaming`, `text`.
- `Pending` (Schema) and `PendingOps`: `add`, `rollBack(pending,
  clientMessageId)`, `settle(pending, conversation)` (drops those the saved
  copy holds, matched by `clientMessageId`).
- `transcript(conversationId, maybeConversation, pending, maybeLive)` gives
  `TranscriptRow[]`: saved messages, the live reply in place of its saved
  copy, any older reply to the question being regenerated hidden, and
  pending messages at the end. Each row has `key`, `role`, `parts`,
  `status` (or `sending`), `attachments`, `failure` and `source`.
- `ConversationResult` and `ConversationListResult` are `AsyncResult`
  Schemas for Model fields.

### Tests

```
cd packages/native
FOLDKIT_DIR=/home/claude/repos/fk/src NG_NATIVE_DIR=/home/claude/repos/ngn/src \
  node_modules/vitest/vitest.mjs run test/aiBackendServer.test.ts test/aiBackend.test.ts
```

Both use Effect's `TestClock` for every delay, the client's batching window
and the demo's once-a-second counter included. These deliberate defects
were tried one at a time, and each made a test fail: batching off, no
rollback of a refused message, no optimistic insert, a rename that announces
no topic, stop that does not keep the partial reply (server test and demo
test), a crashed reply not marked stopped on load, no save at the end of a
turn, no resume on return to the app, no automatic reconnect, no skipping of
repeated pieces, and a drop switch that never cuts.

### Limits

- The cable is in-process, so nothing here measures a real network's
  latency, buffering or reconnect behaviour.
- One reply at a time per conversation. The server refuses a second.
- Attachments are carried and saved as facts only: name, type, size.
- A deleted conversation's turn is stopped, but a screen still showing it
  gets `ChatError` with kind `not-found` from its read.
- `Atom.family` keeps one conversation atom per id for the program's life.
