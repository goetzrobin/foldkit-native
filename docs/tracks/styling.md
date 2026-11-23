# Track: styling

CSS classes, Tailwind, and dark mode that updates without re-running the
Foldkit view.

## Background

- The engine `@ng-native/fabric` (source:
  `/home/claude/repos/ngn/src/packages/fabric/src`, especially `engine.ts` and
  `css.ts`) has a real CSS cascade. `Engine` takes options including
  `globalStyles`, `tokens`, `conditions`. It has `addClass`/`removeClass`, and
  `updateConditions(next)`, which re-resolves styles and commits by itself.
- Our adapter already forwards `h.Class('a b')` to
  `engine.addClass`/`removeClass` (`classModule` in
  `packages/native/src/modules.ts`) and passes all `EngineOptions` through
  `createNativeSurface(fabric, rootTag, options)`.
- ng-native compiles CSS at build time in its Metro package:
  `/home/claude/repos/ngn/src/packages/metro` (`config.cjs`,
  `css/compile.cjs`, `css/*`). Tailwind preset:
  `/home/claude/repos/ngn/src/packages/tailwind` (`README.md`, `config.cjs`,
  `native.css`). Both are on npm as `@ng-native/metro` and
  `@ng-native/tailwind` at 0.25.0. The Metro package also contains the
  Angular compiler, which we do NOT want. Find out how to use only the CSS
  compile and Tailwind parts without Angular: read how `withAngularNative`
  and `withTailwind` work, what file they generate (for example
  `.angular-native/app.tailwind.js`), and what shape `globalStyles` expects.
  Prefer calling ng-native's own compile functions over re-implementing them.
  If `withTailwind` can run without `withAngularNative`, use that. If not,
  write the thinnest Metro config helper that produces the compiled
  stylesheet module.
- A theme watcher exists in ng-native, free of Angular:
  `/home/claude/repos/ngn/src/packages/device/src/conditions.ts`
  (`currentConditions`, `watchConditions`) with its small local imports. Port
  what is needed (color scheme, window size, font scale) so the engine is
  told when the phone switches light/dark or rotates. On a phone these read
  React Native's `Appearance`, `Dimensions`, `PixelRatio`. Do not import
  `react-native` inside `packages/native`: accept those as injected sources
  (the app passes them), so tests can fake them.

## Deliver (new files only, per the brief)

1. `packages/native/src/styling/` with: a function that builds the engine
   options (`globalStyles`, initial `conditions`) from a compiled stylesheet
   and injected device sources; a watcher that calls
   `engine.updateConditions` on change and returns a stop function; an
   `index.ts` exporting the public API. Views use `h.Class` (already
   supported).
2. A new Expo app `apps/styled/`. Copy `apps/notes` as the base
   (`package.json`, `app.json`, `tsconfig.json`, `metro.config.js`,
   `index.ts`, `vendor/`). Add Tailwind (v4, per ng-native's README) and the
   Metro wiring so `h.Class('flex-1 bg-white dark:bg-black p-4')` works. It
   embeds your demo program. `scripts/sync-apps.sh` copies
   `packages/native/src` into every app that has `src/foldkit-native`.
3. `packages/native/test/demos/styling.ts` (the demo program, contract in
   the brief): a screen styled only with Tailwind classes, showing light and
   dark variants, an `ios:`/`android:` variant if the preset supports it, a
   few spacing, flex, typography and border utilities, and a visible count of
   how many times the view function has run, so a person can see that
   toggling the phone's dark mode changes colors WITHOUT that count going up.
   (Count view runs with a module-level variable in the demo file. The value
   shown is from the last render.) Include an Exit button calling `env.exit`.
4. `packages/native/test/styling.test.ts`: on the simulated phone, prove that
   (a) a class resolves to native style props from a compiled stylesheet,
   (b) calling the watcher with a dark color scheme changes the committed
   props, and (c) the Foldkit view function did not run again for that
   change. For tests you may compile a small CSS string with ng-native's
   compiler from source, or hand-write `globalStyles` in the exact compiled
   shape. Say which.
5. Prove the app builds: in `apps/styled` run `npm install`,
   `npx tsc --noEmit`, and
   `CI=1 npx expo export --platform ios --platform android --output-dir /tmp/fkn-styled`.
   Fix until they pass.

## Constraints

Do not edit core files or other apps (see the brief). Do not modify the
Foldkit fork. If something in a core file blocks you, work around it locally
and describe the exact change needed.
