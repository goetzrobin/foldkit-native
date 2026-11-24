# Worklets: can Foldkit Native animate on the UI thread without React?

Written for the project owner first. The technical appendix at the end is
for an engineer.

## What a worklet is

A phone app does its thinking on one thread and its drawing on another. A
worklet is a small function that is copied over to the drawing thread, so it
keeps moving things on screen while the thinking thread is busy.

Today everything Foldkit Native moves is moved from the thinking thread
(JavaScript). When JavaScript is busy, motion stops. Apps built with React
solve this with two libraries, Reanimated and Gesture Handler. Both are
written as React components. The question was whether we can use the parts
under the React layer.

## The answer

**Go, with limits.** Nothing has run on a phone yet, so this is a reading of
the source code plus a proof that builds and passes its tests on the
simulated phone. The Worklets demo exists to get the real answer: its six
status lines say, on your phone, which pieces work.

## What the source code says

1. **Running code on the UI thread needs no React.** The library that does
   it, `react-native-worklets`, never imports React. We load it as it is.
2. **Moving a view from the UI thread needs no React either.** The part of
   Reanimated that changes views is native code. It is started with one
   call. It finds a view by a handle that our engine already holds. React
   apps have to dig that handle out of a component. We just read it.
3. **Our way of drawing does not confuse it.** Reanimated watches every draw
   that reaches the phone and puts its own values back on top. It does this
   for any draw, ours included, because it watches at the level below React.
4. **Gestures can be attached to a view by its number.** Gesture Handler's
   native module does that, and sends the finger's movement to a worklet
   through Reanimated's native code.
5. **Someone has done this already.** ng-native, the engine we sit on, ships
   worklet styles and gestures for Angular with no React rendering, on the
   same Expo version we use. That is the strongest sign this works.
6. **The build step is automatic.** Worklets need a compile step (a Babel
   plugin). Expo adds it by itself once the package is installed. I checked
   the exported app: all 16 of our worklets were compiled.

## What was built

A new folder, `packages/native/src/worklets/`, and a "Worklets" demo.

- A check for each piece that never crashes the app. A missing piece becomes
  a line of text with the reason.
- `runOnUi`: start a function on the UI thread.
- `shared`: a value both threads can use.
- `uiThread`: ties a view's style to a worklet. When the shared value
  changes, the view moves, with no work in JavaScript.
- `sendMessage`: a worklet sends word back and Foldkit gets a Message.
- A spring that runs on the UI thread.
- A pan gesture read on the UI thread.

The demo shows the status lines, an orange box moved by a worklet next to a
blue box moved by JavaScript, a button that blocks JavaScript for two
seconds, and a card to drag.

## What does not work, or is not known

- **Nothing here has run on a phone.** The tests use a stand-in for the UI
  thread. They prove our logic. They cannot prove the phone's native code
  accepts what we send it.
- **Expo Go must contain all three native pieces.** Expo's documentation
  lists Reanimated and Gesture Handler as included in Expo Go. It does not
  say so for `react-native-worklets` in words, but Reanimated cannot work
  without it. The first status line tells us.
- **Colors.** The proof moves, resizes and fades views. It does not change
  colors from the UI thread. Reanimated's React-side code is what prepares
  colors for native code, and the proof does not load that code.
- **Only a spring.** No timed easing, no decay, no chained animations. Those
  live in Reanimated's JavaScript, which the proof does not load.
- **Only a pan gesture.** No tap, pinch, long press, or rules between
  gestures.
- **Android is a guess.** Gestures there need a special wrapper view. It is
  in the code, copied from how ng-native does it, and unseen on a device.
- **A view moved from the UI thread stays under its control.** If Foldkit
  later sets the same style on that view, the UI thread's value wins until
  the view is removed.

## What it would cost to finish

Rough sizes, in days of one engineer's work. They assume the phone says yes
to the status lines.

- **Two to three days.** Fix what the phone finds. Expect at least one
  surprise per platform.
- **Three to five days.** A real animation set: timing, spring, decay,
  sequences, colors. There are two ways. One is to keep writing our own, as
  the proof does. The other is to load Reanimated's own functions (they are
  plain functions and draw nothing with React) the way ng-native does. The
  second is less work and gives the full library. It means the `react`
  package is loaded as code, though nothing is drawn through it.
- **Three to five days.** Gestures beyond pan, and gestures that must agree
  with scrolling.
- **About a week.** The chat keyboard logic from
  react-native-keyboard-controller. Its hard part, about 1,200 lines that
  decide where the list should sit, is already written as worklets and can
  be used almost unchanged. The React wrapping around those worklets has to
  be rewritten for Foldkit. Its test files are a ready-made check.

Two to three weeks in all for a finished layer, less if only one of the
last three is wanted.

## Recommendation

1. Run the Worklets demo in Expo Go on the iPhone and answer W1 to W8 in the
   phone checklist. That takes ten minutes and settles most of the open
   questions.
2. If the lines say yes and the orange box keeps moving while JavaScript is
   blocked, finish it, and use Reanimated's own functions for the animation
   set instead of writing our own.
3. If line 1 or line 4 says no, send the reason it prints. Line 1 failing
   means Expo Go lacks the native piece and a development build is needed.
   Line 4 failing means the native code refused our handle to the view, and
   the reason will say where to look.

---

# Technical appendix

Versions read: `react-native-worklets` 0.13.0, `react-native-reanimated`
4.7.1, `react-native-gesture-handler` 3.3.0 (the npm tarballs, which carry
the native sources), `babel-preset-expo` from Expo SDK 58, `@ng-native/fabric`
0.25.0, ng-native source at `0069c28`.

## 1. react-native-worklets

**React-free.** `grep` over `src/` finds one import from outside the
package: `TurboModuleRegistry` from `react-native`
(`src/specs/NativeWorkletsModule.ts`). `react` is a peer dependency and is
never imported.

**Start-up.** Importing the package runs `init()`
(`src/initializers/initializers.native.ts`), which builds `NativeWorklets`
(`src/WorkletsModule/NativeWorklets.native.ts`):

- `TurboModuleRegistry.get('WorkletsModule').installTurboModule(false)` puts
  `__workletsModuleProxy` on the RN runtime's global and creates the UI
  runtime.
- `loadUnpackersWithCode(...)` sends six bootstrap worklets to it, then
  `start()`.
- `runOnUISync` then installs `console`, `queueMicrotask`,
  `requestAnimationFrame`, timers and `__serializer` on the UI runtime.
- If `__workletsModuleProxy` is still undefined it **throws**. In
  development it also throws when the native version's major.minor differs
  from the JavaScript version (`src/debug/checkCppVersion.ts`).

So the package cannot be imported at the top of the app. We `require` it
inside a function, in a try, on first use (`src/worklets/host.ts`,
`apps/showcase/index.ts`).

**What a worklet is after the plugin.** For a function whose first statement
is `'worklet'`, the plugin emits a factory that returns the same function
with three properties:

    fn.__closure     = [the outside values it reads]
    fn.__workletHash = a number
    fn.__initData    = { code: "(function name(args){const[a,b]=this.__closure; ...})" }

In development `__initData` also has `location` and `sourceMap`.
`createSerializable(fn)` sends `__initData` once and the closure values
with it. A closure value that is a worklet goes over as a worklet. One that
is a plain function goes over as a "remote function", which the UI runtime
can only hand back to `scheduleOnRN`.

**Threads.** `scheduleOnUI(fn, ...args)` queues and flushes in a microtask
through `__workletsModuleProxy.scheduleOnUI`. `runOnUISync` blocks the RN
runtime. On the UI runtime, `scheduleOnRN(fn, ...args)` is
`__workletsModuleProxy.scheduleOnRN(fn, __serializer(args))`. Our
`sendMessage` worklet calls those two globals directly, so `ui.ts` needs no
import from the package.

**Shared memory.** `createShareable(UIRuntimeId, initial, { hostDecorator })`
makes a value hosted on the UI runtime. There it is `{ value }`, passed
through our decorator (which adds listeners). On the RN runtime it is a
guest with `getSync()` and `setAsync()` and no `.value`. Reanimated 4.7's
own shared values are built on this same call (`src/mutables.native.ts`).

**Self-reference.** `const step = () => { 'worklet'; ...step... }` compiles
to a factory that receives `step` before it is initialised. Recursion must
go through a function nested inside the worklet. `springTo` does this.

## 2. The Babel plugin

`babel-preset-expo/build/configs/expo.js`: unless the `worklets` or
`reanimated` option is `false`, it resolves `react-native-worklets/plugin`
from the project root and adds it. No `babel.config.js` is needed and the
showcase has none. The plugin transforms every file Metro transforms,
including `apps/showcase/native/**` (the synced copy of `packages/native`).

Checked on `expo export --no-bytecode --no-minify`: 73 functions in the
bundle carry `__workletHash`. Sixteen are ours: `uiTs1` to `uiTs12` (all
twelve worklets in `src/worklets/ui.ts`) and `workletsTs1` to `workletsTs4`
(the demo's three style worklets and its pan handler). `sendMessage`'s
closure is `[UI_RUNTIME, _channel.deliver]`, so an imported plain function
is captured by reference as expected. The Hermes bytecode export contains
the same code strings.

In the tests there is no plugin. The `'worklet'` line is inert and worklets
run as ordinary functions against `test/support/worklets.ts`.
`requireCompiledWorklets(false)` turns off the `__workletHash` check that
otherwise makes `runOnUi` refuse an uncompiled function.

## 3. Reanimated 4.7.1

**Start-up without its JavaScript** (`src/ReanimatedModule/NativeReanimated.ts`,
`apple/reanimated/apple/ReanimatedModule.mm`):

    globalThis.__UI_WORKLET_RUNTIME_HOLDER = worklets.getUIRuntimeHolder()
    globalThis.__UI_SCHEDULER_HOLDER = worklets.getUISchedulerHolder()
    TurboModuleRegistry.get('ReanimatedModule').installTurboModule()
    delete both globals

It returns false when Fabric has no scheduler yet, so we call it after a
first draw and do not remember a false. On success the RN runtime has
`__reanimatedModuleProxy`, and `UIRuntimeDecorator::decorate` has put on the
UI runtime: `_updateProps`, `_measure`, `_dispatchCommand`,
`_maybeFlushUIUpdatesQueue`, `_getAnimationTimestamp`, `_setGestureState`,
`_obtainProp`, and two layout-animation hooks. Native code warns in debug
builds if `_REANIMATED_VERSION_JS` is unset. Release builds skip the check.

**Applying props.** `_updateProps([{ shadowNodeWrapper, updates }])`
(`ReanimatedModuleProxy::init`, `AnimatedPropsRegistry::update`) reads the
shadow node from the JSI object's native state and keeps only its *family*.
Any clone of the node works, however stale. `performOperations` then clones
the shadow tree with the new props and commits it from the UI thread,
mounting synchronously. With the default feature flags
(`USE_ANIMATION_BACKEND: false`) frames come from worklets' own loop, and
Reanimated's display link is paused unless it asked for a render, so
`_maybeFlushUIUpdatesQueue()` after `_updateProps` is what sends the change.
Reanimated's own `updateProps` worklet does the same.

**Identifying a view.** `@ng-native/fabric` 0.25.0 has
`engine.shadowNodeOf(node)` and `engine.tagOf(node)`, documented for exactly
this. `views.ts` uses them and falls back to `node.committed.handle` and
`.tag`. `keyboard/drive.ts` uses the tag alone because React Native's
Animated module addresses views by tag. `skia/canvas.ts` uses a `nativeID`.
Reanimated wants the shadow node.

**Our commits.** The engine commits through
`nativeFabricUIManager.completeRoot`, the same binding React uses, so Fabric
marks them `CommitSource::React`. `ReanimatedCommitHook::shadowTreeWillCommit`
then overlays every prop in its registry onto our tree and pauses
Reanimated's own commits until `ReanimatedMountHook` sees ours mounted. That
is the React behaviour, unchanged. What React apps have and we do not:
`PropsRegistryGarbageCollector` (JavaScript) copies settled values back into
React state so the registry can forget them. Without it the registry keeps
the last value per view until the view unmounts. We call
`markNodeAsRemovable` on destroy so it forgets then.

**What the proof skips.** `stylePropsBuilder.build` (color and transform
string processing), mappers with a per-frame finalizer (we flush per
change, so two inputs changing in one frame commit twice), `withTiming`,
`withSpring`, `withDecay`, `interpolate`, `scrollTo`, layout animations,
CSS animations.

**ng-native's route.** `packages/components/src/reanimated.ts` imports
`makeMutable`, `startMapper`, `stopMapper` from `react-native-reanimated`,
`updateProps` from `react-native-reanimated/src/updateProps/index.ts` and
`registerEventHandler` from `.../src/core.ts`, and binds a mapper to
`{ tag, shadowNodeWrapper: engine.shadowNodeOf(node) }`. That loads
Reanimated's index, which requires `react` and creates components that are
never rendered. It gets the whole animation library in exchange.

## 4. Gestures

`RNGestureHandlerModule` (TurboModule) has `createGestureHandler(name, tag,
config)`, `attachGestureHandler(handlerTag, viewTag, actionType)`,
`dropGestureHandler`, `flushOperations`. With `actionType` 1
(`REANIMATED_WORKLET`) both platforms hand each event to Reanimated's native
module (`sendEventForReanimated`), which calls
`UIEventHandlerRegistry::processEvent(eventName, viewTag, payload)`. A
worklet registered with
`__reanimatedModuleProxy.registerEventHandler(serializable, name, viewTag)`
is called as `(timestamp, event)` for `onGestureHandlerEvent` (updates
while active) and `onGestureHandlerStateChange`. The payload is flat:
`state`, `oldState`, `translationX`, `velocityX`, and so on.

On iOS the recogniser is attached to the view itself. The attach retries
for a view that is not mounted yet. On Android the view must be inside an
`RNGestureHandlerRootView` whose `moduleId` prop is
`globalThis._RNGH_MODULE_ID` (set by the native module when it is first
obtained). `gestureRoot` draws that on Android and a plain view elsewhere.

The simpler route, raw touch events: on iOS Reanimated's event listener
sees `topTouchMove` on the main thread and would deliver it to a handler
registered for `onTouchMove`. On Android its `EventHandler.receiveTouches`
is an empty method with the comment "not interested". So raw touches are
iOS only and Gesture Handler is the route that covers both.

Not done: gesture relations (simultaneous, require-to-fail),
`_setGestureState` for manual activation (`installUIRuntimeBindings`), the
version 3 detector views. ng-native reuses the library's own `Gesture.Pan()`
objects and `attachHandlers`, which brings all of that.

## 5. Keyboard controller's chat logic

`src/components/KeyboardChatScrollView/` is about 1,600 lines without tests.
`useChatKeyboard/index.ios.ts`, `index.ts` (Android) and `helpers.ts` are
worklets that read and write `.value` on shared values and call
`interpolate` and `scrollTo`. They are driven by `useKeyboardHandler`, which
registers worklets for the native view's `onKeyboardMoveStart`,
`onKeyboardMove`, `onKeyboardMoveEnd` and `onKeyboardMoveInteractive`
events through Reanimated's event registration, by view tag.

What would stay: the worklet bodies and helpers, nearly as written, and the
spec files as a behaviour check. What must be rewritten: `useSharedValue`
(our `shared`, or Reanimated's `makeMutable`), `useAnimatedReaction` and
`useDerivedValue` (a listener on shared values, or `startMapper`),
`useAnimatedRef` (our `uiRef`), the event registration (the same call our
pan uses), `scrollTo` (`_dispatchCommand(shadowNode, 'scrollTo', [x, y,
animated])`), and `ScrollViewWithBottomPadding`, which sets the scroll
view's inset through animated props. With ng-native's route most of these
are Reanimated's own functions and only the hook shell is new.

## What is in the proof

| File | What |
|---|---|
| `src/worklets/host.ts` | Finds the three native pieces. Starts Reanimated's native module. Never throws. |
| `src/worklets/ui.ts` | Every worklet: shared value decorator, `bindStyle`, `springTo`, `bounceBetween`, `measureView`, `probeView`, `sendMessage`, the event wrapper. |
| `src/worklets/run.ts` | `runOnUi`, `runOnUiSync`, `shared`, `readShared`, `writeShared`. A local stand-in where there is no UI thread. |
| `src/worklets/channel.ts` | The JavaScript end of `sendMessage`. |
| `src/worklets/views.ts` | `uiThread`, `onUiMessage`, `uiRef`, `gestureRoot`, and the module that ties elements after each commit. |
| `src/worklets/status.ts` | The yes or no checks behind the demo's status lines. |
| `test/support/worklets.ts` | The stand-in UI thread for tests. |
| `test/worklets.test.ts` | 34 tests. |
| `test/demos/worklets.ts` | The demo. |

Stubs and limits, exactly: no colors or string transforms in worklet
styles. One animation (spring). One gesture (pan, default config). The
style worklet's inputs are listed by hand. Style changes are flushed per
change, not once per frame. No scroll events, no `scrollTo`. Reanimated's
JavaScript version global is not set (a warning in debug builds of the
native code).
