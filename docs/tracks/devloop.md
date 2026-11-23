# Track: dev loop

Hot reload on the phone that keeps the Foldkit Model, plus a native crash
screen.

## Background

- On the web, Foldkit keeps state across a code change like this: before the
  page reloads it sends the encoded Model to the Vite dev server, and on
  startup asks for it back. See
  `/home/claude/repos/fk/src/packages/foldkit/src/runtime/modelPreservationBridge.ts`
  and every use of `import.meta.hot` in
  `/home/claude/repos/fk/src/packages/foldkit/src/runtime/` (`runtime.ts`,
  `start.ts`, `makeElement.ts`, `makeApplication.ts`), plus the Vite plugin at
  `/home/claude/repos/fk/src/packages/vite-plugin-foldkit/src/index.ts`. The
  Model has an Effect Schema, so it can be encoded to plain data and decoded
  again. If decoding fails after a Model shape change, Foldkit starts fresh.
- On a phone the bundler is Metro. Metro has its own HMR: a module can call
  `module.hot.accept(...)` and the app keeps running while new code loads. If
  nothing accepts, Metro does a full reload. Expo SDK 58 rewrites
  `import.meta` to a registry object, so `import.meta.hot` is undefined on
  the phone (our apps bundle fine today). For reference only, see how
  ng-native hooks Metro HMR:
  `/home/claude/repos/ngn/src/packages/metro/angular-transform.cjs` (search
  `module.hot`) and
  `/home/claude/repos/ngn/src/packages/platform/src/adapter.ts`
  (`installReloadHook`, `hot`).
- Our app entry (`apps/notes/index.ts`) does:
  `AppRegistry.registerRunnable('main', ({ rootTag }) => { const surface = createNativeSurface(...); Runtime.embed(makeNotes(surface.container, device)) })`.
  `Runtime.embed` returns a handle with `dispose`. On the phone a JS global
  survives a Metro hot update (the JS runtime is not restarted) but not a
  full reload.

## Goal

When a developer saves a file, the running app swaps to the new code and
redraws with the SAME Model (typed text, open screens, list contents all
kept). If the Model's shape changed so the saved one no longer decodes, start
fresh without crashing.

## Deliver

1. `packages/native/src/devLoop/` (new files only, per the brief) exporting
   something like `runWithHotReload({ surface, make, module })` that the app
   entry calls in place of `Runtime.embed`. It embeds the program, and on a
   Metro hot update disposes the old program, re-requires the new program
   factory, and embeds it again with the preserved Model. Work out the
   cleanest way to get the current Model out of a running Foldkit program and
   into the next one. Prefer Foldkit's existing preservation machinery with a
   non-Vite transport.

   This is the ONE track allowed to change the Foldkit fork at
   `/home/claude/repos/fk/src/packages/foldkit/src` if needed (for example,
   make the preservation bridge's transport pluggable in place of the
   hardwired `import.meta.hot`). Rules for fork changes:
   - Keep the change minimal and web behaviour identical.
   - Keep `npx tsc -p tsconfig.json --noEmit` clean and Foldkit's own tests
     passing (`cd /home/claude/repos/fk/src/packages/foldkit && npx vitest run`,
     3,131 pass today).
   - Other tracks are running against the fork source right now. Do not break
     its public API, and do not leave it in a non-compiling state between
     steps.
   - Regenerate the patch:
     `cd /home/claude/repos/fk/src && git diff > /home/claude/wt/devloop/foldkit-fork/foldkit-render-target.patch`
     (the new `renderTarget` directory is already intent-to-add).
   - Rebuild the tarball:
     `cd /home/claude/repos/fk/src/packages/foldkit && pnpm run build && pnpm pack --pack-destination /tmp/fkn-pack`
     and copy it into YOUR app's `vendor/` under a NEW file name
     `foldkit-0.171.0-native.3.tgz`, updating only your app's `package.json`.
2. A native crash screen. Today when a Foldkit program crashes, Foldkit
   patches in a crash view built from HTML elements (see
   `/home/claude/repos/fk/src/packages/foldkit/src/runtime/crashUI.ts` and the
   `crash` config of `Runtime.makeElement`). Find the supported way for an
   app to provide its own crash view and provide a native one (red title, the
   error message, a Reload hint) built from our native elements, as an
   exported helper programs can pass in. If Foldkit offers no hook that works
   on native, describe the minimal fork change and make it.
3. A new Expo app `apps/devloop/`. Copy `apps/notes` as the base, including
   `vendor/`. Run `scripts/sync-apps.sh` to copy the adapter into
   `apps/devloop/src/foldkit-native`. Its entry uses your hot-reload runner.
   Its program (also provided as `packages/native/test/demos/devLoop.ts` per
   the brief's demo contract) shows: a counter, a text field, a list you can
   add to, a line of text that says "Edit me in src/demo.ts and save", and a
   button that deliberately crashes the program to show the native crash
   screen. Include an Exit button calling `env.exit`.
4. `packages/native/test/devLoop.test.ts`: simulate a hot update on the
   simulated phone without Metro. Embed a program, change its Model through
   presses and typing, call your runner's swap function with a NEW program
   factory whose view differs, and assert the new view is drawn with the old
   Model. Then swap to a factory whose Model schema is incompatible and
   assert it starts fresh without throwing. Also test that the crash screen
   draws native views.
5. Prove the app builds: in `apps/devloop` run `npm install`,
   `npx tsc --noEmit`,
   `CI=1 npx expo export --platform ios --platform android --output-dir /tmp/fkn-devloop`.
   Also check that the bundle Metro produces in DEV mode contains your
   `module.hot.accept` path (inspect how Metro exposes `module.hot` in the
   bundled module wrapper), and say exactly what you verified versus assumed.

## Constraints

Do not edit core adapter files or other apps (see the brief).
