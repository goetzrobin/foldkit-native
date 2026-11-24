# foldkit-native

Foldkit programs on native iOS and Android views.

[Foldkit](https://github.com/devinjameson/foldkit) is an Elm-architecture
framework for TypeScript, built on Effect. It draws to the browser. This
project lets the same kind of program draw real native views, with React out
of the render path. It does that by sitting on `@ng-native/fabric`, the
framework-neutral engine inside
[Angular Native](https://github.com/ng-native/ng-native).

**Status: proof of concept.** Not for production use.

## The showcase app

`apps/showcase` is one app with a menu of demos. Each demo is a complete
Foldkit program.

| Demo | What it shows |
|---|---|
| Notes | Type, add a note, open it, swipe back. The first app this project ran on a phone. |
| Navigation | Tabs, a deep stack, a modal and a sheet, title bar buttons, blocking Back. |
| Lists and motion | 5,000 rows with about 40 drawn, pull to refresh, fades, and a card you can drag. |
| Chat | A list that opens at the newest message and stays there, with a text field above the keyboard. |
| AI chat | Your question goes to the top and the answer is written under it, word by word. |
| Styling | Tailwind classes, with colors that change when the phone goes to dark mode. |
| Phone features | Haptics, clipboard, saved text, share sheet, alerts, keyboard, network, rotation. |
| Keyboard dock | A text field that rides on the keyboard. A label says which of its two modes is in use. |

Chat and AI chat have a button, "Keyboard: following" or "Keyboard: simple",
that switches between two ways of keeping the text field above the keyboard.

## Run it

You need Node 22 or newer, and Expo Go on a phone on the same Wi-Fi.

```
cd apps/showcase
npm install
npm start
```

Scan the QR code with the phone's camera.

- `docs/PHONE_CHECKLIST.md` lists what to look at on the phone, as yes or no
  questions.
- `docs/DEV_BUILD.md` explains how to make a development build, for when
  Expo Go lacks the native code the keyboard dock needs to follow the
  keyboard frame by frame.

## What has been seen on a phone

The Notes demo ran in Expo Go on an iPhone with iOS 27: native views, text and
styles, presses, a text field that keeps up with fast typing, a screen stack
with a title bar and swipe-back, and a scroll view.

The other demos pass their tests on a simulated phone. The simulated phone
checks what the program asks the phone to do. It cannot show layout or
movement, so those demos still need the checklist. Chat, AI chat and Keyboard
dock have not been seen on a phone at all. Nothing has run on Android.

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
| `packages/native/` | The adapter, with its demos and tests that run on a simulated phone |
| `apps/showcase/` | The app with every demo in a menu |
| `apps/devloop/` | A small app for trying reload that keeps your state |
| `apps/notes/`, `apps/counter/` | The first two apps, kept as the smallest examples |
| `foldkit-fork/` | The change Foldkit needs, as a patch against 0.171.0 |
| `docs/BRIEF.md` | How to work on this, and what the phone has taught us |
| `docs/PHONE_CHECKLIST.md` | What to check on a real phone |
| `docs/DEV_BUILD.md` | How to make a development build of the showcase |

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
