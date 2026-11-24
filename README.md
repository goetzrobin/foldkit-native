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
| AI chat on Legend List | The same AI chat, built on Legend List's own list code (MIT, copied into `packages/native/src/legend/vendor`) with no React. |
| Styling | Tailwind classes, with colors that change when the phone goes to dark mode. |
| Phone features | Haptics, clipboard, saved text, share sheet, alerts, keyboard, network, rotation. |
| Keyboard dock | A text field that rides on the keyboard. A label says which of its two modes is in use. |
| Object tracking | A tracking game drawn every frame with Skia, or with plain views where Skia is missing. Shows frame timing after each trial. |
| Glass | Liquid Glass over scrolling colours: a card, a pill, a round button, two shapes that flow into one. A line says if it is real glass or the plain fallback. A second screen shows the tab bar options iOS 26 added. |
| Worklets | Code on the phone's UI thread with no React. Status lines say which pieces this build has. An orange box keeps moving while a button blocks JavaScript for two seconds, and a card follows a finger. See `docs/WORKLETS.md`. |
| Server state | A crew list from a pretend server, kept in a cache outside the Model. A panel says what was loaded, when and why. Buttons slow the server, fail a request, and edit from "another device". See `docs/SERVER_STATE.md`. |
| Swipe actions | Rows you drag sideways for actions: an inbox with separate rounded tiles and full swipe to delete with Undo, a task list in the classic strip, and chat bubbles that show their time. Controls pick what moves the rows (the UI thread or JavaScript) and say why. See `docs/SWIPE_ACTIONS.md`. |
| Swipe actions (native view) | Inbox rows that swipe to show Flag, Delete and Read, drawn and moved by this project's own native view: Swift (UIKit) on iOS, Kotlin on Android, in `apps/showcase/modules/foldkit-swipe`. It needs an app you build yourself. In Expo Go the rows show but do not swipe, and a line says so. The native code has not been compiled or run yet. See `docs/NATIVE_VIEWS.md`. |

Chat and AI chat have a button that goes round three ways of keeping the text
field above the keyboard: "Keyboard: inset" (the default: the messages are not
resized, the list scrolls to make room, as react-native-keyboard-controller and
Legend List do it), "following" and "simple". AI chat also has "Lift: ...", for
what the messages do as the keyboard opens, and "Show numbers".

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
movement, so those demos still need the checklist. Chat, AI chat, Keyboard
dock, Glass, Worklets and Swipe actions have not been seen on a phone at all. Nothing has run on Android.

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
