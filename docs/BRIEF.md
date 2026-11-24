# Working brief

Read this before changing anything. It is written for an engineer (human or
agent) who starts with no context.

## What this project is

Foldkit is an Elm-architecture framework for TypeScript, built on Effect. It
draws to the browser DOM. This project makes Foldkit programs draw **native
iOS and Android views** instead, with React out of the render path.

It does that by sitting on `@ng-native/fabric`, the framework-neutral engine
inside Angular Native (ng-native). The engine turns DOM-like calls (create
element, append child, set prop) into React Native Fabric commits.

Status: a proof of concept. A notes app (native screen stack, text field,
scroll view, swipe-back) runs on a real iPhone in Expo Go. The goal now is a
working "Phase 2": styling, hot reload, more navigation, lists and motion,
phone features, each shown in a showcase app.

## Layout

```
packages/native/        the adapter (this is the product)
  src/host/             knows nothing of Foldkit: effect and the engine only
    fabric/             node API, surface, core node hooks, the hooks registry
    device/ list/ ...   phone services, the list and swipe and keyboard logic
  src/foldkit/          the Foldkit binding: the only folder importing foldkit
    mount.ts            createNativeSurface: a place a program can draw
    modules.ts          node hooks as Foldkit modules; nodeOf, bagOf
    extend.ts           registerModule: add behaviour without editing core
    elements.ts         view, text, scrollView, image, textInput
    navigation/         stack, screen, header, safeArea, onDismissed, ...
  src/index.ts and src/<folder>/index.ts   the public paths, re-exporting both
  test/                 programs and tests on a simulated phone
  test/boundary.test.ts fails if a file in src/host imports foldkit
apps/notes/             Expo app, runs on a phone (copy of the adapter in src/foldkit-native)
apps/counter/           the first, smallest app
foldkit-fork/           the patch Foldkit needs
docs/                   this brief
```

## Checkouts on this machine

| What | Where | Notes |
|---|---|---|
| Foldkit fork | `/home/claude/repos/fk/src` | 0.171.0 + our patch, already applied and built. `packages/foldkit/src` is the source. |
| ng-native | `/home/claude/repos/ngn/src` | Source at commit `0069c28`. Read it as the reference for everything native. |
| Legend List | `/home/claude/repos/ll/src` | Reference for list virtualisation. |

Treat these three as read-only unless your track says otherwise. The Foldkit
fork may only change when a track truly needs it. If you change it, keep the
change small, keep Foldkit's own tests passing
(`cd /home/claude/repos/fk/src/packages/foldkit && npx vitest run`), and say
so clearly in your report.

## Run the tests

```
cd packages/native
FOLDKIT_DIR=/home/claude/repos/fk/src NG_NATIVE_DIR=/home/claude/repos/ngn/src \
  node_modules/vitest/vitest.mjs run
```

In a fresh checkout or worktree, first run
`FOLDKIT_DIR=/home/claude/repos/fk/src scripts/setup-tests.sh` from the repo
root. It creates `packages/native/node_modules` links.

The tests run a real Foldkit program against ng-native's fake Fabric
(`@ng-native/testing/fake`, see `test/support/phone.ts`). The environment is
plain Node: no DOM, no `requestAnimationFrame`. If code reaches for a browser
global, the test fails. Keep it that way.

To run against the engine build the apps install from npm (0.25.0), add
`FABRIC_ENTRY=/home/claude/work/foldkit-native/apps/notes/node_modules/@ng-native/fabric/dist/index.js`.
The source checkout is slightly newer than 0.25.0. Code must work on both.

## Check an app builds

```
cd apps/<app>
npm install
npx tsc --noEmit
CI=1 npx expo export --platform ios --platform android --output-dir /tmp/<some-dir>
```

There is no phone or simulator here. Bundling proves the code loads into a
bundle the phone's JavaScript engine (Hermes) accepts. It proves nothing
about layout or feel.

## How a Foldkit view reaches the phone

A view is a function `(model, h) => Html`. Native elements are builders made
with `element()('tag')` from `foldkit/renderTarget` (see `src/elements.ts`).
They take `(attributes, children)` like `h.div`.

Attributes come from three places today:

- `h.*` from Foldkit: `h.Key`, `h.Attribute('testID', 'x')`, `h.OnClick(msg)`
  (means "press"), `h.OnInput(text => msg)`, `h.Placeholder`, `h.Class`.
- `prop(key, value)`: any native prop with any value type.
- `style({...})`: React Native style names and values. `h.Style` only accepts
  web CSS property names, so native-only names must use `style`.

Events: an entry `on.<name>` on a node is listened for as the native event
`top<Name>` and delivered as a `CustomEvent` whose `detail` is the native
payload (see `eventsModule`). Build attributes for them with `OnCustomEvent`
from `foldkit/renderTarget` (see `onDismissed` in `src/navigation.ts`).

Native view names are registered with `registerViewName(tag, viewName,
defaultStyle?)` from `@ng-native/fabric`.

## Lessons from the phone (do not relearn these)

1. **Do not depend on `requestAnimationFrame` or timers for the first draw.**
   On a first launch in Expo Go the clock was not running and the screen stayed
   blank. Foldkit's render is scheduled with a microtask on native.
2. **A rule copied from ng-native out of its component can be wrong here.**
   Its top safe-area rule hid our content under the title bar on iOS 27. Read
   the whole component, not one line, and say in your report what you could
   not verify.
3. **A screen runs under its navigation bar on iOS.** The safe area view
   insets the top. See `safeArea`.
4. **A scroll view needs one content child** with `collapsable: false`, as
   React Native's ScrollView makes. See `scrollView`.
5. **`h.Style` rejects non-CSS names** and crashes the program.
6. **The published engine (0.25.0) lacks some methods the source has**
   (`engine.dispose`). Type-check apps against the npm package to catch this.
7. **Effect's `Array.filterMap` is not JavaScript's.** Plain array methods are
   fine in views.
8. **Laptop tests cannot see layout.** All tests passed while the text field
   sat hidden under the title bar. Tests catch logic only.

## Rules for working in parallel

Several tracks run at once, each in its own git worktree. To keep merges
trivial:

- **Add new files. Do not edit the core files** `nodeApi.ts`, `modules.ts`,
  `mount.ts`, `elements.ts`, `navigation.ts`, `index.ts`, `extend.ts`,
  `test/support/phone.ts`, or anything under `apps/notes` and `apps/counter`,
  unless your track owns that file (stated in your task).
- Need behaviour on your own elements? Prefer node hooks in `src/host`
  (`registerNodeHooks` from `src/host/fabric/registry.ts`): they know no
  Foldkit and survive the move to Effect UI. A Foldkit module factory
  (`registerModule` from `src/foldkit/extend.ts`) is for what needs virtual
  nodes. Helpers `nodeOf`, `bagOf` are in `src/foldkit/modules.ts`,
  `customEvent`, `handlersByNode` in `src/host/fabric/nodes.ts`. See
  `docs/EFFECT_UI.md`.
- Need a change in a core file? Do not make it. Describe the exact change in
  your report and work around it locally if you can.
- Put your public API in `src/<track>/index.ts` (or `src/<track>.ts`). The
  integrator adds the re-export to `src/index.ts`.
- Do not add npm dependencies to `packages/native`. If an app needs one, say
  which and why in your report.

## What each track delivers

1. Source under `packages/native/src/<track>...`.
2. A demo program `packages/native/test/demos/<track>.ts` exporting:

   ```ts
   export type DemoEnv = Readonly<{
     device: Device            // from src/navigation.ts
     exit: () => void          // call to leave the demo (back to the menu)
   }>
   export const makeDemo = (container: HTMLElement, env: DemoEnv) =>
     Runtime.makeElement({ Model, init, update, view, container })
   ```

   It must be a complete Foldkit program that shows your features on one or
   more screens, with a visible way to call `env.exit`. Label things on screen
   so a non-engineer can tell what to try and what should happen. It imports
   the adapter from `'../../src/index.js'` and your track from its own path.
3. Tests `packages/native/test/<track>.test.ts` on the simulated phone, in
   the style of `test/notes.test.ts`. Test behaviour, not implementation.
4. A report (your final message), in this shape:
   - **Built:** what works, with file paths.
   - **Verified:** which commands you ran and their results.
   - **Not verified:** everything that only a real phone can show, as a
     checklist of yes/no questions for a person holding the phone.
   - **Core changes needed:** exact edits to core files or the Foldkit fork.
   - **App needs:** npm packages, Metro or app.json changes.
   - **Risks:** where you copied a rule from ng-native without its context.

## Code style

- TypeScript, no semicolons, single quotes, 2 spaces, trailing commas, as in
  the existing files.
- Comments say why, in plain words. Every file starts with a comment that a
  newcomer can read.
- Foldkit conventions: Messages are named for what happened
  (`PressedAdd`, `ChangedDraft`), never for what to do. Side effects go in
  Commands and Subscriptions, never in `update` or `view`.
- No `any` in public signatures where a real type is practical.
