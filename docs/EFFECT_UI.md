# Getting ready for Effect UI

## In plain words

Foldkit is the framework this project's programs are written in. Its author
has joined the Effect team, and Foldkit is moving into Effect. A new version,
called Effect UI here, will replace today's Foldkit. Programs will need to be
moved to it, but not written again. The author's own words: "Migrated, yes.
Rewritten, no."

We do not know exactly what Effect UI will look like. We have seen a few
screenshots. So the aim of this work was simple: make the move small and
easy to plan, without changing anything people see today.

We did three things.

**1. We split the adapter in two.** The adapter is the code that lets a
Foldkit program draw real iPhone and Android screens. It now has two parts.

- The **phone part** (`src/host`) talks to the phone: the screen, scrolling,
  the keyboard, swipes, sheets, the microphone, the clipboard and the rest.
  It knows nothing about Foldkit. When Effect UI comes, this part stays as
  it is. It is about 29,000 lines, of which 12,600 are code we copied from
  two other projects.
- The **Foldkit part** (`src/foldkit`) connects the phone part to Foldkit.
  It is the only part that mentions Foldkit. When Effect UI comes, this
  part is written again for Effect UI. It is about 12,000 lines, and most
  of it is short and repetitive.

A test checks the line between the two on every run. If someone makes the
phone part depend on Foldkit, the test fails.

**2. We cut Fold Chat into parts.** Fold Chat is our finished chat app. It
used to be one big program. It is now eight parts, each with its own small
piece of state and its own screen area: the list of chats, the chat screen,
the transcript, one message, the reply being written, the box you type in,
the settings sheet and the reasoning sheet. The app at the top only routes
between them and hands down what they share. Effect UI is built around parts
like these (it calls them Components), so each part becomes one Component.

**3. We made sure a recording of a session can replay it.** Some things on
screen are not kept in the program's own state: where the list is scrolled,
whether a swipe is open, how high a sheet is, what the keyboard is doing.
They now report every change to the program. A new test records every
message of a whole session (sending, streaming, stopping, regenerating,
renaming, switching to dark) and replays the messages into a fresh copy of
the program. The copy ends up in exactly the same state, step by step,
without talking to the server. Effect UI promises this kind of replay as a
debugging tool, so it helps to know our app already allows it.

### What happens when Effect UI ships

| Part | What happens | Size |
|---|---|---|
| The phone part | Stays as it is | 187 files, about 29,000 lines |
| The Foldkit part | Written again for Effect UI | 73 files, about 12,000 lines |
| Fold Chat | Each part converted to a Component | about 4,300 lines |
| The demo programs (`test/demos`, 26 files) | Converted the same way, one at a time | about 14,000 lines |
| Apps (`apps/showcase`, `apps/chat`) | A few import lines change | small |

A rough guess: the Foldkit part is a few weeks of focused work for one
engineer, much of it mechanical. Fold Chat is about a week. The demos can
follow at any pace, because each one stands alone.

### What we need from the Effect team

The engineer's list is at the end of this file. In short: let a host other
than the browser draw, without depending on the browser's animation clock;
let the host bring its own set of elements; give native events and values a
proper way in; and make replay and the developer tools work on a phone.

## Engineer's appendix

### The two layers

```
packages/native/src
  host/        effect and @ng-native/fabric only. 187 files, 28,969 lines
               (12,594 of them vendored: Legend List and the kbc helpers)
  foldkit/     the binding. The only folder importing foldkit. 73 files, 11,866 lines
  index.ts, navigation.ts, <folder>/index.ts
               the public paths, kept as re-export files (22 files, 192 lines)
```

Before: 57 of 128 non-vendored files in `src` imported Foldkit, in every
folder. After: 56 files import Foldkit, all in `src/foldkit`.
`test/boundary.test.ts` checks that every import in `src/host` is
`effect`, `@ng-native/fabric` or another file in `src/host` (so the host is
Foldkit-free all the way down, not only file by file), and that no file
outside `src/foldkit` imports `foldkit`.

Public paths: `src/index.ts` and each old folder's `index.ts` re-export from
the new places, so apps, demos and tests that import a folder compiled
unchanged. Imports of single files inside a folder (a few tests and demos,
Fold Chat, the chat app's search bar) were rewritten mechanically.

### The seams

- **Node hooks** (`host/fabric/nodes.ts`). An element's behaviour is a set
  of hooks over engine nodes: `create(node, data)`, `update(node, before,
  after)`, `destroy(node, data)`, `post()`. `data` is the element's data
  bag (props, attrs, class, style, on, and any marker a feature put there).
  The core behaviours (props, classes, styles, events, presses, the text
  field echo, screens) are node hooks. `foldkit/modules.ts` turns hooks into
  Foldkit modules (`fromNodeHooks`).
- **One ordered registry** (`host/fabric/registry.ts`). Host features
  register node hooks at import (`registerNodeHooks`), the binding registers
  Foldkit modules into the same list (`registerModule`), so every module
  runs in the order it registered, as before.
- **The surface** (`host/fabric/surface.ts`): the engine, the full-screen
  view committed at once, commits on the engine's own clock, the jobs that
  wait for a commit. `foldkit/mount.ts` adds Foldkit's updater and the
  render target.
- **The list** (`host/list/controller.ts`). The windowing and anchoring
  state machine takes engine events (scroll, layout, drag, fling, a row's
  height, the keyboard, a new spec) and produces engine calls (scroll to,
  insets), a canvas plan, and events for the program. A painter draws the
  plan; Foldkit's painter, with the second updater for rows, is
  `foldkit/list/module.ts`.
- **The keyboard dock** (`host/keyboard/dock.ts`): the controller. The
  binding (`foldkit/keyboard/dock.ts`) builds the element and finds the
  dock's views in the virtual tree.
- **Swipe** (`host/swipe`): the row behaviour is node hooks; the types take
  the passive content type as a parameter, fixed to `Html` in the binding.
- **Phone services** (`host/device`): service, live Layer and test fake per
  feature, and `live`/`makeTest` for all. Messages, Commands and
  Subscriptions are in `foldkit/device`, which re-exports the host half.
- **Server state and AI chat** (`host/serverState/store.ts`,
  `host/aiChat/client.ts`): the atom registry, writes, the client, and the
  live turn as a Stream (`followTurn`). The Subscriptions (`watchAtom`,
  `focusEntry`, `liveTurnEntry`) are the binding's.
- **Native view names** (`host/navigation/views.ts`, `host/menus/views.ts`,
  `host/controls/views.ts`, `host/markdown/views.ts`, `host/skia/views.ts`,
  the dock's two views) and the element vocabulary as data
  (`host/elements.ts`, `host/style.ts`).

### File by file group

**Stays** (`src/host`): fabric bridge; elements and styles as data; native
view names; phone services; list windowing and anchoring; keyboard dock
controller, keyboard detection and drive; swipe core, stages, styles,
UI-thread side and row behaviour; swipe native detection; Legend List's core
and its driver; motion clock; worklets (host, run, UI-thread code, channel,
status); Skia drawing and host; glass and markdown detection; markdown
native styles and themes; menu items and the native sheet; navigation's
Android back; the dev loop store; styling; server state store, sync and
optimistic helpers; AI chat wire, transport, server, replies and client.

**Rewritten** (`src/foldkit`, by folder, lines):

| Folder | Lines | What is in it |
|---|---|---|
| navigation | 1,674 | stack, screens, title bar, search, sheets, tabs, routes |
| controls | 1,356 | switch, slider, segments, pickers over Expo UI and React Native views |
| device | 1,086 | Messages, Commands and Subscriptions for 14 phone features |
| legend | 856 | the Legend List element and its painter |
| menus | 830 | context, pull-down and title bar menus, action sheet Command |
| markdown | 778 | the element, the native view module, the plain fallback |
| list | 771 | the list element, its painter, pull to refresh |
| swipe | 576 | the swipe row element and its drivers |
| worklets | 514 | tying an element to worklets |
| swipeNative | 417 | the native swipe view element |
| devLoop | 395 | hot reload that keeps the Model, crash screen |
| skia | 365 | the canvas element |
| motion | 362 | animated, transition, draggable |
| game | 353 | the tracking game's arena |
| keyboard | 337 | the dock element, finding its views |
| glass | 301 | glass elements |
| chat | 217 | composer dock, chat safe area |
| serverState | 200 | `watchAtom`, `focusEntry` |
| aiChat | 140 | `liveTurnEntry` |
| (root) | 338 | elements, attributes, modules, mount, extend, crash, nodeApi |

Some binding modules still hold engine work of their own, written against
virtual nodes: the motion module (enter and exit animations), the menu
module (holds and the in-app list), tabs, the sheet probe, the Legend
painter, the markdown native module, the Skia canvas module, the worklets
view module, the native swipe module, pull to refresh, and the dynamic view
names of glass, Expo UI, native swipe and worklets. Each can move to the host
as node hooks in the same way the list, swipe and dock did; it was left for
later because each is short and none blocks the move. Rewriting them with
Effect UI's own element model is the other option.

**Converted** (Fold Chat, `packages/native/flagship`):

| Part | File | Model | Becomes |
|---|---|---|---|
| list of chats | `parts/conversationList.ts` | search, open swipe row | Component, list data as a query |
| chat screen | `parts/chatScreen.ts` | open chat, pending, notice, menu | Component; children as Components |
| transcript | `parts/transcript.ts` | anchor, at end, following, keyboard phase | Component |
| message row | `parts/messageRow.ts` | none: drawn from inputs | Component with props only |
| reply stream | `parts/replyStream.ts` | live turn, joining, haptic memory | Component, the live turn as a query or Subscription |
| composer | `parts/composer.ts` | draft, voice note, recording | Component |
| settings sheet | `parts/settingsSheet.ts` | none: settings are shared | Component reading a Provider |
| reasoning sheet | `parts/reasoningSheet.ts` | row, sheet height | Component |

The app (`app.ts`, `appModel.ts`) routes and wires; `context.ts` is what the
parts share (the future Provider); `list` and `conversation` at the top of
the Model are server data (the future query cache), handed down as view
inputs (the future props). What converts, part by part:

- `Submodel.defineView` and `h.submodel({ viewInputs })` become
  `Component.define({ props, model, message }).make({ init, update, view })`,
  with `viewInputs` as props.
- List-of-attributes views (`view([style(...), h.OnClick(m)], children)`)
  become chained builders (`h.view.style(...).onClick(m).children(...)`).
  Our own attribute helpers (`style`, `prop`, `onPress`) become builder
  methods of the native element vocabulary.
- `defineMessageUnion({...})` becomes `UiSchema.TaggedEnum({...})`; the
  `Message.match` updates become the `update: { Tag: $ => ... }` record.
- The hand-built server-state bridge (`watchAtom` into `ChangedList`,
  `ChangedConversation`) becomes the query cache, read in views with its
  own loading and failure states.
- Flags that stand for a running Command are marked
  `// effect-ui: h.isRunning`: `pending`, `isDraftFocusPending`, `menu`,
  `joiningTurnId`, the live turn's `isStopping` and `connection: 'resuming'`.
  Foldkit 0.x cannot read a Command's running state, so they stay for now.
- OutMessages (`ConversationList.OutMessage`, `ChatScreen.OutMessage`,
  ...) become whatever Effect UI gives a Component to talk to its parent.

The demos in `test/demos` convert the same way and can go one at a time.

### State outside the Model, and replay

| State | Kept by | Reaches the program as |
|---|---|---|
| list at end | the list | `onAtEndChanged` (was there) |
| list following its end | the list | `onFollowChanged` (new) |
| list position | the list | not sent: it follows from the Messages above and the rows; sending every scroll would flood the log |
| keyboard height | the phone | `Phone.Keyboard` Shown and Hid (was there) |
| keyboard phase (moving, at rest, dragged) | the dock and the list | `onKeyboardMoved` on a list with an inset (new) |
| swipe row open | the swipe row | `onOpened`, `onClosed` (were there; Fold Chat now listens) |
| sheet height | the phone's sheet | `onDetentChanged` (was there; Fold Chat now listens) |
| live reply buffer | the client | every piece arrives in a `ReceivedTurnUpdate`, batched |
| recorder status | the recorder | `ChangedRecorderStatus` each tick; the level meter is drawn outside the Model and Fold Chat does not show it |

`test/flagship/replay.test.ts` records a session through the app's
`onMessage` hook, then folds `update` over the recorded Messages from a
fresh `init`, with no Command run, and compares every Model. A deliberate
defect (an update that reads a counter kept outside the Model) makes it
fail at the first Message that reads it.

### What a native host needs from Effect UI

1. **A render target without the browser.** A way to register a host's own
   patch and node functions for a container, as `foldkit/renderTarget` does
   with our patch (`foldkit-fork/`). The first draw must not wait for
   `requestAnimationFrame`: on a phone that clock can be paused while the
   app comes to the front, and the first screen stayed blank. Let the host
   schedule frames (we use a microtask).
2. **The element vocabulary as a parameter.** `elements: Html` in
   `Component.define` suggests this. A native host needs its own set (view,
   text, scroll view, text field, screen, sheet, native controls) with
   typed props, and a way to add tags at run time (we name native views
   with `registerViewName`).
3. **Attributes and events for native props.** Props of any value type (not
   only strings), React Native style names that web CSS does not have, and
   events named `top<Name>` carrying a native payload. Today we use `Prop`
   and `OnCustomEvent` and a stand-in `CustomEvent` class, because Hermes
   has none.
4. **Layout and measuring.** A way for a host to measure a node after a
   commit and to run work after the commit reached the phone (our
   `afterCommit` jobs), for lists, the keyboard dock and anchoring.
5. **The text field echo protocol.** The phone owns the text while the user
   types; each change carries a count, and text the program changes is
   sent back with the latest count. The runtime must let a host keep the
   field's value outside the normal prop diff.
6. **List rows owned outside the Model.** Our lists draw rows with a second
   updater as the user scrolls, with no Message and no view call. They need
   a supported way to build elements "as if in the view" later (today the
   `viewInputs` frame replay of `h.submodel`) and to dispatch from them.
7. **UI-thread work.** Worklets and native animation drivers run outside
   JavaScript's thread. The runtime must not assume it owns every change to
   a node's style.
8. **Native modules.** Phone features arrive as Effect services built from
   modules the app passes in. Commands and Subscriptions over them should
   need nothing more than Effect Layers.
9. **Devtools and replay on a phone.** Recording and replay must work
   without a browser: logs that can leave the phone (over the dev server),
   and replay that runs `update` with the recorded props, query results and
   Provider values, as described. Our replay test shows the shape we need.
10. **Hot reload that keeps the Model.** We patched in a transport for the
    Model (`foldkit/renderTarget`'s `setModelPreservationTransport`); a
    supported hook would remove the patch.

### How to check

```
cd packages/native
FOLDKIT_DIR=/path/to/foldkit-fork NG_NATIVE_DIR=/path/to/ng-native \
  node_modules/vitest/vitest.mjs run test/boundary.test.ts test/flagship/replay.test.ts
```
