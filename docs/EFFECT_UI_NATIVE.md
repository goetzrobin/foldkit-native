# Effect UI Native

## In plain words

Effect UI is the new version of Foldkit, the framework our apps are written
in. It came out in public preview on 26 November 2026. This work makes Effect
UI programs draw real iPhone and Android screens, the way our Foldkit
programs already do, with React drawing nothing.

What exists now:

- **A native host.** Effect UI draws through a small part called a host. It
  ships with one for web pages and one for terminals. We wrote one for
  phones. It sits on the same engine as before (ng-native) and reuses the
  "phone part" of our adapter unchanged. Nothing in `packages/native` was
  edited.
- **Native building blocks.** Boxes, text, buttons, scrolling, text fields,
  pictures, screens with the phone's own title bar and swipe back, sheets,
  glass, Markdown and a drawing canvas.
- **A playground app** (`apps/eui-playground`) with six screens: a counter,
  notes, a 1,000 row list, touch tests, phone features, and a list loaded
  from a pretend server. It is there to answer questions on a real phone.
- **188 tests** on a simulated phone, all passing. 135 of them came with
  Effect Chat, the port of Fold Chat, which is now done in three steps. See
  `docs/EFFECT_UI_CHAT.md`.

Effect UI itself needed no change. It runs on the phone's JavaScript engine
as it is.

The two questions:

1. **Can a long list be an ordinary Effect UI component?** Yes. A scroll is a
   Message, the component remembers which rows are drawn, and each row is a
   small component. On a laptop a scroll step that draws costs 1.5 to 3
   thousandths of a second of JavaScript, and three out of four steps draw
   nothing at all. Only the rows that come into view are worked on, never
   the whole list. We also tried the other way, where the list places its
   rows itself. It works, but it is no faster, and each row becomes an
   island cut off from the rest of the app. We recommend the first way.
2. **Do touches behave?** In tests, yes: a press on a row, a hold, a button
   inside a row, and a press while the app scrolls the list by itself. The
   last one is the bug that broke holding a streaming reply in Fold Chat.
   The host carries a workaround for it.

What we do not know yet is everything only a phone can show: whether the
list feels smooth, whether the first screen comes up, whether the title bar
and swipe back look right. `apps/eui-playground/README.md` has ten checks
for that.

Porting Fold Chat is the next phase. Our estimate is three to four weeks
for one engineer. The plan is at the end.

## How the host maps to the engine

Effect UI's renderer changes the screen through a `Renderer.Host`: a short
list of functions. `packages/effect-ui-native/src/NativeHost.ts` is that
list over ng-native's engine nodes.

| Host operation | What the native host does |
|---|---|
| `createElement(tag)` | Makes an engine node. A few vocabulary tags are another tag to the engine (`pressable` is a `view`, `scrollView` is `scroll-view`). A scroll view also gets its one content view. |
| `createText`, `setText` | Engine text nodes. Words sit inside a `text` element. |
| `setProp`, `setAttr` | Kept per node, written at the commit. A style object equal to the last one is no work. `contentStyle` on a scroll view styles its content view. |
| `setEvents` | Handlers are kept as data. Listeners stay attached across draws and read the newest handlers. |
| `insertBefore`, `remove`, `parentOf`, `nextOf` | Engine child operations. Children of a scroll view go into its content view, and the renderer never sees that view. A removed node is destroyed at the commit, unless it was put back. |
| `createContainer` | A shelf in JavaScript for the nodes of a kept child. The engine does not know it. |
| `commit` | Runs the node hooks for every element that changed, sends one engine commit, then runs the work that waits for a commit. |
| `controlled` | `value`: a text field's text is checked after every draw. |
| `elements` | `['native']` |
| `runsMounts` | `true` |
| `head`, `hydration`, `viewTransition` | Left out. A phone has no document. |

Reused from `packages/native/src/host` with no edit:

- `fabric/surface.ts`: starts the engine, commits a full-screen view in the
  same turn the phone started the app, queues work for after a commit.
- `fabric/nodes.ts`: the node hooks for props, styles, events, the text
  field echo and screens. The host builds each element's data bag and calls
  the hooks once per flush.
- `fabric/registry.ts`: hooks other features registered (modal screens, the
  app window) run too.
- `list/window.ts`: the list arithmetic.
- `device/*`: the phone services.
- `navigation`, `glass`, `markdown`, `skia`, `worklets/hold.ts`: view names,
  detection, styles, painters.

New in `packages/effect-ui-native/src/internal`:

- `touch.ts`: the press recogniser (see "Touch" below).
- `events.ts`: which native event a vocabulary event is, and its payload.

**Scheduling.** Effect UI mounts synchronously and queues each later flush
with a microtask. So the first screen needs no animation frame and no
timer. One case did need care: when one of the app's Layers gives its turn
away before the mount (reading settings, say), Effect resumes it with a
timer. `NativeHost.run` gives the app a Scheduler that runs its first
rounds of work as microtasks and then goes over to timers.
`test/start.test.ts` starts the app the way the phone does and lets only
microtasks through.

**The text field echo.** The phone owns the text while the user types. Each
change carries a count. When the Model's text differs from what the phone
last said, the Model's text goes back as a command with the latest count
(`fabric/nodes.ts`, unchanged). One addition: when the Model refuses typed
text and stays the same, Effect UI draws nothing, so the host checks the
field once more after the Message.

**Events.** A view names an event (`press`, `longPress`, `changeText`,
`submit`, `focus`, `blur`, `layout`, `scroll`, `scrollBeginDrag`,
`scrollEndDrag`, `momentumScrollEnd`, `scrollEnd`). Payloads are plain data:
`{ x, y }`, `{ text }`, `{ x, y, width, height }`, and for a scroll
`{ x, y, contentWidth, contentHeight, width, height, byUser }`. Any other
name is a native view's own event: `dismissed` is `topDismissed`, with a
copy of what the phone sent. Scroll Messages are at most one per 16 ms, and
the last position is always delivered.

## The vocabulary

```ts
import { Native, NativeCommand, NativeHost, NativeMount, NativeViews, Phone, VirtualList } from 'effect-ui-native'

const Counter = Native.component({ name: 'Counter', model, message }).make({
  init: () => ({ count: 0 }),
  update: { PressedAdd: $ => $.evolve({ count: n => n + 1 }) },
  view: (h, model) =>
    h.view.style({ padding: 16 }).children(
      h.text(String(model.count)),
      h.pressable.pressedStyle({ opacity: 0.5 }).on('press', Message.PressedAdd()).children(h.text('Add')),
    ),
})

NativeHost.run(NativeHost.mount(Counter, {}, { fabric: getFabricUIManager(), rootTag }))
```

| On `h` | What it is |
|---|---|
| `view`, `pressable`, `text`, `scrollView`, `textInput`, `image` | The core six |
| `stack`, `screen`, `modalScreen`, `header`, `headerItem`, `safeArea`, `sheetContent` | The phone's screen stack, title bar, safe area and sheets |
| `h.el('any-tag')` | Any native view an app registered with `registerViewName` |

Every element has `.style({...})` (typed React Native styles),
`.pressedStyle({...})`, `.set({...})` (typed native props), `.testId(id)`,
`.on(event, handler)`, `.key`, `.ref`, `.onMount`. A text field has
`.value(text)` and `.placeholder(text)`. A box refuses a bare string, when
the code is checked and when it runs.

| Module | What it gives |
|---|---|
| `NativeHost` | `mount(Component, props, { fabric, rootTag })` returns a Layer. `run(layer)` starts it. `makeSurface`, `layerFromSurface` for tests and embedding. |
| `NativeCommand` | `focus(ref)`, `blur()`, `scrollTo(ref, { y })`, `scrollToEnd(ref)`, `measure(ref)` |
| `NativeMount` | `Measure`, `TrackLayout`, `TrackHold` (the phone's own long press, attached to the native view), `Fade` (a view that fades in and out and stays in the tree). Write your own with `Mount.make` and `Native.Host`. |
| `NativeQuery` | `layer`, `visibility`, `connectivity`: tells Effect UI's query cache when the app is in front and when the phone is online. See `docs/EFFECT_UI_CHAT.md`. |
| `NativeViews` | `sheet(options)` and `sheetParts(h, { body, footer })` for what goes inside one, `barButtons(header, options)`, `searchBar(h, options)`, `spinner(h, ...)`, `glass(h, options)`, `markdown(h, options)`, `makeCanvas(name, args, paint)`, and the register and status functions |
| `Menus` | The phone's own list of choices as a Command: `Menus.Show`. `Menus.live`, `Menus.makeTest()`. `MenuItem` is what a bar button's menu holds |
| `Phone` | Commands `Impact`, `Selection`, `Notify`, `Copy`, `Paste`, `DismissKeyboard`, with `Phone.live(modules)` and `Phone.layer`. Over the whole of `Phone.Device.live(modules)`, `Phone.layerAll` adds `StorageGet`, `StorageSet`, `Share`, `OpenUrl`, `SetAppearance`, the recorder (`RequestMicrophone`, `StartRecording`, `StopRecording`, `CancelRecording`), the player (`PlaySound`, `StopSound`) and speech recognition (`RequestSpeech`, `StartListening`, `StopListening`, `AbortListening`). Subscriptions `keyboard`, `appState`, `colorScheme`, `network`, `recorder`, `player`, `speech` |
| `VirtualList` | `Model`, `init`, `scrolled`, `measured`, `view` |
| `AnchoredList` | A chat's list: the host's list controller places it, Effect UI draws the rows. `Window`, `init`, `view`, `scrollToEnd`, `touch`, `numbers`, `numbersLabel`. See `docs/EFFECT_UI_CHAT.md`, step 2 |
| `KeyboardBar` | A bar the phone moves with the keyboard, over a list that makes room with a bottom inset. `view`, `configure`, `mode`, `isInset` |
| `effect-ui-native/src/testing` | `NativeTest.mount(Component, props)`: a simulated phone with `press`, `touchStart`, `typeText`, `scroll`, `emit`, `text`, `commands`. `ChatPhone.start(app, options)`: a scroll view that behaves as UIKit's does, and a keyboard that moves the bar |

A screen stack is state in a Model. The component that owns the stack draws
one `h.screen` per entry, the last one on top, and listens for `dismissed`
to drop the screens the phone closed by itself. `playground/app.ts` shows
it.

A view that listens for `longPress` can also ask for the phone's own long
press recogniser, with the host's timer as its backup:
`.prop(NativeHost.NODE_DATA, { [NativeHost.NATIVE_HOLD]: true })`.
`NativeHost.holdReport()` says which way read the last hold. See "How the
hold works" in `docs/EFFECT_UI_CHAT.md`.

Not wrapped yet: the phone's context menu, Expo UI controls, swipe rows and
tabs. Their native halves are in the host layer. A host feature that finds
its elements by a key in the node's data can be switched on for an element
with the `nodeData` prop (`NativeHost.NODE_DATA`): the list and the keyboard
bar work that way.

## Question 1: lists

### Way A: the list is a component

`src/VirtualList.ts` and `playground/longList.ts`.

- The scroll view's `scroll` event is a Message.
- The Model holds the window: the first and last row drawn, the measured
  row heights, the viewport height.
- `VirtualList.scrolled` works out the window. Rows are drawn 600 points
  ahead, and the window only moves when half of that is used up. When the
  window stays, the function returns the same Model and Effect UI draws
  nothing.
- The view draws a spacer, the rows, a spacer. Each row is a child
  component drawn from props, so it draws again only when its props change.
- Each row reports its height once the phone has laid it out.
- With `recycle`, a row's key is its slot, not its id. A row that comes in
  reuses the component and the native views of one that went out.

Measured by `test/listNumbers.test.ts`: 1,000 rows of Markdown-like text
(a heading, one to four lines, sometimes bullets or a code line), an 800
point screen. The simulated phone reports a height for each new row, as a
phone would. Time is Node on this laptop, averaged over three runs.

| | Keyed by id | Recycled by slot |
|---|---|---|
| Scroll steps that draw, at 120 points a step | 37 of 150 | 42 of 150 |
| JavaScript per step that draws nothing | 0.3 ms | 0.3 ms |
| JavaScript per step that draws: average | 2.8 ms | 1.6 ms |
| 95 in 100 steps are under | 6.3 ms | 2.3 ms |
| The longest step | 8.0 ms | 7.8 ms |
| List view runs per drawing step | 2 | 2 |
| Row view runs per drawing step | 4 (most: 5) | 4 (most: 6) |
| Native views made per drawing step | 32 | 0 |
| Engine commits per drawing step | 2 | 2 |
| Native views alive | 165 | 213 |

At 600 points a step (a hard fling) every step draws: 2.5 ms on average
keyed by id, 1.8 ms recycled, 5 or 6 row views per step.

How to read it:

- **The whole list never draws again.** A drawing step runs the list's view
  twice (once for the new window, once for the batch of measured heights)
  and the views of the four or so rows that came in. The other rows are not
  touched: their props did not change.
- **The cost of a step is making native views, not Effect UI.** Recycling
  takes the number made to zero and the time down by about 40%.
- **A phone is slower.** Hermes has no JIT. Expect several times these
  numbers. The phone scrolls on another thread, so a late step shows as a
  blank row at the edge, not as a stutter. The 600 point margin is the
  cushion. The Long list screen shows the real numbers.

### Way B: the list places its rows itself

`src/experimental/SlotList.ts`, tested in `test/listNumbers.test.ts`.

**It works.** This is how:

- The list is a Mount on a scroll view. It listens for scroll events itself
  and keeps the window outside any Model.
- It owns a pool of slot views, made with the engine directly.
- Each slot holds its own Effect UI tree, mounted with `Renderer.mount`
  (through `Native.Host.mountRoot`).
- When the window moves, a slot that went out of sight is moved to the
  other end, and its tree is sent a message naming its new row.
- The component that owns the list hears where the window is, through
  `Mount.map`, and does not draw.

Numbers, same test: 1.5 ms per drawing step, 0 list view runs, 1 commit, 0
native views made. That is the same as way A with recycling, within the
noise.

What it costs, exactly:

1. **A mounted root cannot be given new props.** `Renderer.mount` takes
   props once. So a row is told which row it shows by a message
   (`root.send`), and has to keep that in its Model. Rows become stateful
   where they were drawn from props.
2. **A root cannot report to whoever mounted it.** A row's events go
   nowhere. A press on a row can only change the row's own Model, or go
   through a side channel outside Effect UI.
3. **Each root flushes and commits by itself.** Ten rows changing meant ten
   engine commits, until we added `Native.Host.holdCommits`.
4. **Each root is its own world.** Its own query cache, its own session in
   the message log, no shared state from the app's Providers. A replay of
   the app's Messages no longer shows the list.
5. **A kept child does not help.** `h.keepAlive` keeps a child's nodes
   aside, but only a view can place them again. A host cannot.

**Verdict.** Use way A. Way B buys no speed at this size and gives up what
makes Effect UI worth having inside the list. Keep way B in mind only for a
list whose rows need no connection to the app.

What a chat transcript still needs on top of way A is anchoring: keep the
question in place after Send, follow the end while a reply streams, make
room for the keyboard. The host layer has that logic
(`host/list/controller.ts`). See the plan.

## Question 2: touch

`src/internal/touch.ts`. The host turns a whole touch into one finished
event. A program never gets a Message per finger movement.

| The finger | What happens |
|---|---|
| goes down on a view that listens for `press` or `longPress` | The view shows its `pressedStyle`. No Message. |
| drifts more than 10 points | The press is off. This is what keeps a scroll from pressing a row. |
| starts a scroll, or another view takes the touch | Off. |
| rests for 500 ms on a view that listens for `longPress` | `longPress` is sent. The lift after it sends nothing. |
| lifts while the press is on | `press` is sent, with where the finger was. |
| is on a button inside a pressable row | The button gets the press. The row does not. |

**The scroll bug** (`docs/upstream/ng-native-scroll-ignore.md`).
ng-native 0.25.0 ends a touch on every scroll event of the list it is in,
including scrolls the program made. React Native marks those
`responderIgnoreScroll: true`. When the engine takes the touch away for
such a scroll, the host does not call the press off. It follows the raw
touch events from then on: a lift is still a press, the hold timer keeps
running, a drift or a cancel still ends it. A newer engine never takes the
touch away for those scrolls, and the workaround is simply not used.

Tested on both engines (`test/touch.test.ts`): the engine from source,
which has the fix, and the published 0.25.0, which has the bug. With the
workaround switched off, three tests fail on 0.25.0.

## What Effect UI lacks or makes hard for a native host

For the Effect UI maintainers. Found while writing a third host, after the
DOM and OpenTUI ones.

**Worked well, keep it:** `Renderer.Host` is small and enough. The first
mount is synchronous and a flush is a microtask, so nothing waits for an
animation frame. Vocabularies with `textParents` and `withNoTextContent`
fit native text exactly. Handlers as data, `Mount` with a stream of args,
refs with Commands, `Subscription`, `Command.Service` and `FrameworkServices`
all carried over with no workaround. The package bundled under Metro,
`exports` wildcards and `#dev` imports included, and compiled to Hermes
bytecode. No API that Hermes lacks was found in the core.

1. **No call for "this element is complete".** Props arrive one `setProp`
   at a time, then `setEvents`. A host that acts on an element's whole
   description has to collect them until `commit`. The kernel has `made`
   internally. Please expose it on `Renderer.Host`.
2. **Props are compared by identity.** A view builds a new style object on
   every draw, so `setProp` is called every time. Each host writes its own
   comparison (OpenTUI uses `Equal.equals`, we compare one level deep). A
   comparison the vocabulary can declare per prop would end that.
3. **A refused edit draws nothing.** When `update` returns the same Model
   for typed text, there is no render, so `controlled` props are not
   applied again and the field keeps the refused text. OpenTUI and this
   host both schedule their own check after dispatch. The runtime could
   re-apply controlled props of the element that dispatched.
4. **A host cannot give the runtime a Scheduler.** Fibers start on Effect's
   default, which is a timer. On a phone the first draw must not wait for
   one. `BrowserHost` passes its own Scheduler through an internal option.
   Please make that public.
5. **A root's props are fixed, and a root cannot emit.** There is no
   `root.setProps` and no way to hear a root's events. That blocks
   embedding, and it is what makes way B rows islands.
6. **No batch across roots.** Each root ends its flush with `host.commit`.
   A host with several roots has to hold commits back itself.
7. **A child gives its parent exactly one node.** A feature that owns two
   screens cannot hand both to its parent's native stack. The playground
   lifts every screen to the app component because of this. Children that
   return a list of keyed nodes would fix it.
8. **A host cannot place a child.** A kept child's nodes can only be placed
   by a view. A list that places rows itself, with the rows still in the
   app's tree, is not possible.
9. **`#dev` under Metro.** The `production` condition is not one Metro
   sets, so the dev checks stay on in a release bundle unless the app adds
   the condition by hand.
10. **No hook after the commit for a Mount.** A Mount that measures has to
    wait until its element is on the phone. Refs wait for the commit
    internally. We added our own `afterCommit` to the host service.
11. **Requirements can turn into `unknown` without a word.** One loosely
    typed `update` helper made a component's requirements `unknown`, and
    the error showed up far away, at the mount.
12. **Not on npm.** We built from source and vendored a tarball. The
    snapshot site was not reachable from our build machine.

`Query` was looked at after phase 1 and works on the phone as documented:
see `docs/EFFECT_UI_CHAT.md`. Not looked at yet: the Router on a phone (deep
links, restoring a stack), hot reload that keeps the Model, the devtools
(`@effect/ui-devtools` needs `@effect/ui-kit`), and the host-neutral test
tools (`TestHost`, `Scene`, `Story`).

Known limits of this host:

- A `textInput` is always tied to `.value(...)`. Leave it out and the field
  is held at empty text.
- `focus`, `blur` and `submit` bubble on the phone. An ancestor listening
  for the same name hears them too.
- A row that reports `layout` costs one Message per row. They are handled
  in one flush when the phone sends them together.

## Porting Fold Chat: plan and size

Fold Chat is 4,831 lines in `packages/native/flagship`, with 2,684 lines of
tests. It uses more of the adapter than the playground does.

| Step | What | Size |
|---|---|---|
| 1 | **Phone test of the playground.** The ten checks. Fix what the phone shows. | 1 to 3 days |
| 2 | **Transcript list.** Way A plus anchoring. Run the host's list controller (`host/list/controller.ts`) from a Mount on the scroll view: it keeps scroll position, the end and the keyboard inset, and reports the window as a Message. Rows stay in the owner's view. | 700 to 900 lines, 4 to 5 days |
| 3 | **Keyboard dock** as a Mount over `host/keyboard/dock.ts`. | 300 lines, 2 days |
| 4 | **Markdown**: finish `ShowMarkdown` (streaming fade, selection). | 250 lines, 1 day |
| 5 | **Menus and the action sheet**, swipe rows, the switches and segments in Settings, the search bar, motion. Only what Fold Chat uses. | 1,000 to 1,200 lines, 4 to 5 days |
| 6 | **Phone services**: the other nine (storage, share, alert, network, recorder, player and so on) as `Command.Service` classes. Mechanical. | 400 lines, 1 day |
| 7 | **Server data**: the chat list and a conversation as `Query` services, the live reply as a Subscription over `host/aiChat/client.ts`. | 400 to 500 lines, 2 to 3 days |
| 8 | **Fold Chat itself**: eight parts to eight components, as `docs/EFFECT_UI.md` lists. Views go from lists of attributes to chained builders. OutMessages become `events`. | about 4,800 lines rewritten, 5 to 6 days |
| 9 | **Tests**: port `test/flagship` to `NativeTest`, the replay test included. | about 2,700 lines, 3 days |
| 10 | Phone test of Fold Chat on Effect UI. | 2 to 3 days |

Total: about 3,000 to 3,500 new lines of binding, 4,800 lines of app
rewritten, 2,700 lines of tests ported. Three to four weeks for one
engineer.

Open questions for the port:

- **Hot reload that keeps the Model.** Effect UI has it for the DOM host
  (`#hot`). Whether a native host can use it is not known.
- **The crash screen.** `mount` takes a `fallback`. Reload and Copy need a
  look.
- **The stack.** Fold Chat's sheets and screens all go to one stack owner,
  because a child gives its parent one node (item 7 above).
- **Dev checks in release.** Add the `production` condition to Metro.

## How to check

```
cd packages/effect-ui-native
npm install
NG_NATIVE_DIR=/path/to/ng-native npx vitest run
# and on the engine the apps install, which has the scroll bug:
NG_NATIVE_DIR=/path/to/ng-native FABRIC_ENTRY=$PWD/node_modules/@ng-native/fabric/dist/index.js npx vitest run
npx tsc --noEmit
```

`@effect/ui` is vendored. See `packages/effect-ui-native/vendor/README.md`.
