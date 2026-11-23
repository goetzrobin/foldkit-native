# Track: lists and motion

A long list that only draws visible rows, pull to refresh, and animation.

## Part A: virtualised list (the main piece)

**The problem.** A Foldkit view describes the whole screen after every
Message. A list of 5,000 rows cannot be drawn that way. Only rows near the
screen should exist as native views, and scrolling must NOT go through
Foldkit's update loop (no Message per scroll frame).

**The design.** A `list` element the view uses like:

```ts
list({
  items,
  key: item => item.id,
  estimatedRowHeight: 56,
  row: (item, index) => Html,
  onEndReached: () => Message.ReachedEnd(),
  attributes: [...],
})
```

- The Model holds `items`. The view calls `list(...)` on every render,
  cheaply. It must not build 5,000 row vnodes.
- The adapter owns the window. It listens to the native scroll view's scroll
  events directly on the engine (not as Foldkit Messages), works out which
  rows are near the viewport plus a draw-ahead margin, and renders only those
  rows by running the caller's pure `row` function and patching those row
  subtrees into positioned row containers inside the scroll view's content
  view.
- Rows have varying heights. Start from `estimatedRowHeight`, measure real
  heights as rows appear (the engine reports layout: search `engine.ts` for
  `topLayout`, `measure`, `getBoundingClientRect`, `onLayout`), cache them,
  and correct positions.
- Row press handlers and other attributes in rows work exactly as elsewhere
  (Messages dispatched normally).
- When `items` changes in the Model (add, remove, reorder, edit), the window
  updates correctly on the next render, keyed by `key`.
- `onEndReached` sends ONE Message when the user nears the end, not one per
  frame.
- A Foldkit row is a pure function of its data with no private state, so
  recycling containers is always safe. You may recycle or simply create and
  destroy rows, whichever you can make correct. Correctness first.

**Rendering rows outside Foldkit's normal patch.** The adapter's updater is a
snabbdom instance made with `init(modules, nodeApi)` from
`foldkit/renderTarget` (see `packages/native/src/mount.ts`). You need to
patch a row subtree into an engine node at any time (on scroll), with the
same modules so props, styles and events work, and then `engine.commit()`.
The `registerModule` factory receives `(engine, afterCommit)`. Build your own
snabbdom instance inside your factory with `init([...], makeNodeApi(engine))`,
reusing `makeModules` and `makeNodeApi` exported from
`packages/native/src/modules.ts` and `nodeApi.ts` (importing from core files
is fine, editing them is not).

The row view function needs Foldkit's `h` (HtmlBuilder) and dispatch context.
Study how Foldkit's html builders get their dispatch context
(`/home/claude/repos/fk/src/packages/foldkit/src/html/index.ts`:
`BuildContext`, `runtimeSingleton`, `createElement`, and how lazy and keyed
thunks are evaluated) so that rows built later, outside the main view call,
still dispatch Messages to the right runtime. If Foldkit resolves vnodes
lazily through Effects that need a context, capture what is needed during the
main view call. If this is impossible without a Foldkit fork change, describe
the minimal change precisely in your report and build the best version
possible without it. Do NOT edit the fork: another track owns it.

**References to read first.**

- ng-native's list: `/home/claude/repos/ngn/src/packages/components/src`
  (find the virtual list component, about 1,660 lines; search `virtual`,
  `drawAhead`, `overscan`) for the native facts about scroll events
  (`scrollEventThrottle`, the payload shape `contentOffset`,
  `layoutMeasurement`, `contentSize`), measuring, and keeping scroll position
  when rows above change height.
- Legend List's maths core: `/home/claude/repos/ll/src/src/core` (for example
  `calculateItemsInView.ts`) for computing the visible window and handling
  size corrections. Do not copy Legend List code wholesale. Check its LICENSE
  and say what it is. Write our own, simpler, informed by both.
- The existing `scrollView` in `packages/native/src/elements.ts` shows the
  required native structure (one content child, `collapsable: false`).

## Part B: pull to refresh

A refresh control on `scrollView` and `list` that shows the native spinner on
pull, sends a Message, and stops spinning when the Model says refreshing is
false. See how ng-native does it (search `refresh-control`,
`RCTRefreshControl`, `PullToRefresh`, `AndroidSwipeRefreshLayout`).

## Part C: motion

1. **Transitions through the engine.** The engine supports transitions and
   keyframes (search `engine.ts` and its sibling files for `transition`,
   `keyframes`, `animation`). Find the lowest-level way to say "animate this
   view's opacity or transform over 250ms when the prop changes" WITHOUT a
   compiled stylesheet (inline style properties such as
   `transitionProperty`/`transitionDuration`, or a small hand-built
   `globalStyles`) and expose it as simple helpers. The engine pumps
   animation frames from a clock the host provides (search
   `requestAnimationFrame`, `pump`, `frame` in `engine.ts` and in
   `/home/claude/repos/ngn/src/packages/platform/src/adapter.ts`). Work out
   what our surface must provide for transitions to run, and provide it in
   your own file through an exported function the app calls with the surface.
   Do not edit `mount.ts`. Describe the change you would make there.
2. **Enter and exit.** When a keyed row is added to or removed from a short
   (non-virtualised) list, fade or slide it. Only if the engine supports it
   without Angular (`animate.enter`/`animate.leave` are on the Angular side).
   Say what is and is not available.
3. **Gestures.** A draggable card that follows the finger and springs back,
   using the engine's responder system (`engine.setResponder`,
   `ResponderHandlers` in `engine.ts`) and, if available without Reanimated,
   the native-driven path (`native-drive.ts`, `nativeAnimated`). The drag
   must not send a Message per move. Send one Message at the end. If
   native-driven motion needs a host object from React Native
   (`NativeAnimatedModule`), accept it injected and say what the app must
   pass.

## Deliver (new files only, per the brief)

- `packages/native/src/list/` and `packages/native/src/motion/`.
- `packages/native/test/demos/lists.ts` (demo program per the brief's
  contract): a 5,000-row list with varying row heights and a visible count of
  how many row views currently exist; a button that scrolls to row 2,500 if
  you implement scroll-to-index; add, remove and shuffle buttons; pull to
  refresh that prepends rows; an "end reached" counter. A second screen or
  section with a fading or sliding box toggled by a button and a draggable
  card. An Exit button calling `env.exit`.
- `packages/native/test/lists.test.ts` and `packages/native/test/motion.test.ts`
  on the simulated phone. Emit `topScroll` and layout events on the fake
  Fabric. Assert that only a window of rows is committed, that scrolling
  changes the window WITHOUT the Foldkit view function running again, that
  the Model changing items updates the window, that row presses dispatch
  Messages, that `onEndReached` fires once, and that pull to refresh
  round-trips. For motion, assert the props and commits the engine makes over
  faked frames.
- Prove it builds. Copy `apps/notes` to a new app `apps/lists/` (keep
  `vendor/`), run `scripts/sync-apps.sh`, make its entry embed your demo with
  `{ device, exit: () => {} }`, then `npm install`, `npx tsc --noEmit`,
  `CI=1 npx expo export --platform ios --platform android --output-dir /tmp/fkn-lists`.

## Priorities if time is short

Part A correct and tested first, then B, then C1, then C3, then C2. Say
clearly what you did not get to.

## Constraints

Do not edit core files or other apps. Do not modify the Foldkit fork. No new
npm dependencies in `packages/native`.
