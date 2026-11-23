# foldkit-native

Foldkit programs on native iOS and Android views.

[Foldkit](https://github.com/devinjameson/foldkit) is an Elm-architecture
framework for TypeScript, built on Effect. It draws to the browser. This
project lets the same kind of program draw real native views, with React out
of the render path. It does that by sitting on `@ng-native/fabric`, the
framework-neutral engine inside
[Angular Native](https://github.com/ng-native/ng-native).

**Status: proof of concept.** Not for production use.

## What works on a real iPhone today

Checked in Expo Go on iOS 27:

- Native views, text and styles from a Foldkit view function
- Presses as Messages
- A native text field tied to the Model, with fast typing
- A native screen stack with a title bar and swipe-back, where the Model
  catches up when the phone goes back by itself
- A native scroll view

## Try it

You need Node 22 or newer, and Expo Go on a phone on the same Wi-Fi.

```
cd apps/notes
npm install
npx expo start
```

Scan the QR code with the phone's camera.

## How it fits together

```
your Foldkit program (Model, update, view)      unchanged
        |
Foldkit runtime and updater                     small patch: foldkit-fork/
        |
packages/native  (this repo)                    node calls, props, events, screens
        |
@ng-native/fabric                               shadow tree, commits, CSS engine
        |
React Native Fabric (C++) -> UIKit / Android views
```

Foldkit's updater changes the screen through a short list of node functions.
The patch in `foldkit-fork/` lets a host supply its own. `packages/native`
supplies ones that call the ng-native engine.

## Layout

| Path | What it is |
|---|---|
| `packages/native/` | The adapter, with tests that run on a simulated phone |
| `apps/notes/` | The demo app: notes list, text field, second screen |
| `apps/counter/` | The smallest possible app |
| `foldkit-fork/` | The change Foldkit needs, as a patch against 0.171.0 |
| `docs/BRIEF.md` | How to work on this, and what the phone has taught us |

## Run the tests

The tests run against source checkouts of the Foldkit fork and ng-native.

```
FOLDKIT_DIR=/path/to/foldkit-fork scripts/setup-tests.sh
cd packages/native
FOLDKIT_DIR=/path/to/foldkit-fork NG_NATIVE_DIR=/path/to/ng-native npx vitest run
```

To make the fork: check out Foldkit at `144eeb4`, apply
`foldkit-fork/foldkit-render-target.patch`, and run `pnpm install`.

## Versions

Foldkit 0.171.0, `@ng-native/fabric` 0.25.0, Effect 4.1.0, Expo SDK 58,
React Native 0.88, react-native-screens 4.30.
