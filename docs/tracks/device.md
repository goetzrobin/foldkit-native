# Track: phone features

The phone's non-visual capabilities as Foldkit Commands and Subscriptions.

## Background

- In Foldkit, side effects never happen in `update` or `view`. One-shot
  effects are Commands (`Command.define(name, { args, messages, execute })`
  returning an Effect that yields a Message). Ongoing streams are
  Subscriptions. Read real examples first:
  `/home/claude/repos/fk/src/examples/stopwatch/src/main.ts`,
  `/home/claude/repos/fk/src/examples/weather/src`,
  `/home/claude/repos/fk/src/examples/websocket-chat/src`, and the framework
  source under `/home/claude/repos/fk/src/packages/foldkit/src/command` and
  `.../subscription` (and `managedResource` if relevant). Follow Foldkit's
  conventions exactly: Message naming, failures as Messages
  (`SucceededX`/`FailedX`), Effect services and Layers for dependencies so
  tests can swap them.
- Expo modules expose plain function APIs that do not need React
  (`expo-haptics`, `expo-clipboard`, `expo-secure-store`, `expo-sharing`,
  `expo-linking`, `expo-network`). React Native core also has plain APIs:
  `Keyboard`, `AppState`, `Appearance`, `Dimensions`, `Vibration`, `Alert`,
  `Linking`, `Share`, `AccessibilityInfo`, `BackHandler`. Anything that is a
  React hook or component is out of scope.
- ng-native wraps the same modules as Angular services. Use them as a
  reference for which calls matter and for platform quirks:
  `/home/claude/repos/ngn/src/packages/expo/src` (`native.ts` and the
  per-module files) and `/home/claude/repos/ngn/src/packages/device/src`
  (`keyboard.ts`, `color-scheme.ts`, `screen.ts`, `accessibility.ts`,
  `os.ts`). Port facts, not Angular.
- `packages/native` must NOT import `react-native` or `expo-*` directly. It
  has no such dependencies and its tests run in plain Node. Design each
  capability as an Effect service plus a `live` Layer factory that takes the
  real module as an argument (the app passes
  `import * as Haptics from 'expo-haptics'` and so on), and a `test` Layer
  that records calls and can be driven by the test. Commands and
  Subscriptions depend on the service. Check how Foldkit programs provide
  Layers or resources to Commands (search the Foldkit source and examples for
  `resources`, `Layer`, `provide`, `ManagedResource`, and the options of
  `makeElement`) and use the supported mechanism.

## Deliver (new files only, per the brief) in `packages/native/src/device/`

1. **Haptics** (impact light, medium, heavy; selection; notification success,
   warning, error). Commands.
2. **Clipboard** (copy text, read text). Commands.
3. **Storage** (get, set, remove a string by key, on `expo-secure-store` or
   an AsyncStorage-shaped interface). Commands, plus a small helper to
   persist and restore a Schema-encoded slice of a Model at startup.
4. **Share sheet**, **open URL** and **can open URL**. Commands.
5. **Alert** (native alert with buttons; the pressed button comes back as a
   Message). Command.
6. **Keyboard** (dismiss as a Command; shown and hidden with height as a
   Subscription).
7. **App state** (active, background, inactive) and **color scheme** (light,
   dark). Subscriptions.
8. **Network status** (online, offline). A Subscription if `expo-network`
   supports listening, otherwise a Command that reads it.
9. **Window size and orientation.** Subscription.

A clean `index.ts` exporting everything, with a short doc comment per
capability showing the few lines an app writes to use it.

## Also deliver

- `packages/native/test/demos/device.ts` (demo program per the brief's
  contract): one scrolling screen with a labelled section per capability.
  Buttons that fire each haptic. A text field with Copy and Paste buttons. A
  "remember this" field that survives closing and reopening the app
  (storage). Share and Open URL buttons. An Alert button that shows which
  button was pressed. A live line showing keyboard height, app state, color
  scheme, network status and window size, updating as they change. An Exit
  button calling `env.exit`. The demo takes its Layers from an argument so
  the app can pass live ones and the tests fake ones.
- `packages/native/test/device.test.ts`: run the demo on the simulated phone
  with test Layers. Press each button and assert the right service call was
  recorded and the resulting Message updated the screen. Drive each
  Subscription from the test Layer and assert the screen updates. Test the
  failure path of at least storage and open URL (the service fails, a
  `Failed...` Message arrives, the screen shows it, nothing throws).
- Prove it builds. Copy `apps/notes` to a new app `apps/device/` (keep
  `vendor/`). Add the needed Expo packages to ITS `package.json` with
  versions matching Expo SDK 58 (use `npx expo install <pkg>` inside the app
  so they match the SDK). Run `scripts/sync-apps.sh`. Make its entry build
  the live Layers from the real modules and embed your demo with
  `{ device, exit: () => {} }`. Then `npm install`, `npx tsc --noEmit`,
  `CI=1 npx expo export --platform ios --platform android --output-dir /tmp/fkn-device`.
  Only use modules that are included in Expo Go, so it runs without a custom
  native build. List which ones you used.

## Constraints

Do not edit core files or other apps. Do not modify the Foldkit fork. No npm
dependencies in `packages/native`.
