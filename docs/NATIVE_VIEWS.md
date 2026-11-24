# Writing a native view for your app

This is for someone with a Mac, an iPhone and an Android emulator who does
not write code. It explains how the app drops down to native code, using the
swipe row as the worked example.

**Read this first.** The Swift and Kotlin code in this guide has never been
compiled. The machine it was written on has no Xcode and no Android SDK. The
Kotlin was checked by a Kotlin compiler against Android's real class list
and hand-written stand-ins for Expo. The Swift was only checked for grammar.
Expect the first build to stop on an error or two. The section "If the build
fails" says what to send back.

## What a native view is

Most of this app is TypeScript. Foldkit decides what is on screen and asks
the phone to draw ordinary boxes, text and lists.

A native view is a piece of the screen written in the phone's own language:
Swift on iPhone, Kotlin on Android. It is compiled into the app. It can use
everything the phone offers, such as its gesture system, at full speed and
with no JavaScript in between.

The swipe row is one. While your finger drags a row, only Swift or Kotlin
runs. JavaScript hears about it three times at most: the row opened, the row
closed, an action was triggered.

Native code is not in Expo Go. Expo Go is a ready-made app from the App
Store and you cannot add code to it. A native view needs your own build of
the app, called a prebuilt app or development build.

## The folder

Everything native about the swipe row is in one folder:

```
apps/showcase/modules/foldkit-swipe/
  expo-module.config.json
  index.ts
  ios/
    FoldkitSwipe.podspec
    FoldkitSwipeModule.swift
    SwipeRowView.swift
  android/
    build.gradle
    src/main/java/expo/modules/foldkitswipe/
      FoldkitSwipeModule.kt
      SwipeRowView.kt
```

| File | What it is for |
|---|---|
| `expo-module.config.json` | Six lines that tell Expo "this folder is a module" and name the Swift class and the Kotlin class to load. |
| `index.ts` | Two names, kept next to the native files. Nothing else. |
| `ios/FoldkitSwipe.podspec` | Tells the iPhone build which files to compile. You will not need to change it. |
| `ios/FoldkitSwipeModule.swift` | The list of what JavaScript may use: the module's name, one function, the view's props and events. |
| `ios/SwipeRowView.swift` | The view itself, in UIKit. |
| `android/build.gradle` | Tells the Android build which files to compile and which two libraries it needs. |
| `android/.../FoldkitSwipeModule.kt` | The same list as the Swift one, for Android. |
| `android/.../SwipeRowView.kt` | The view itself, in Android's View system. |

Expo finds the folder by itself. Any folder inside `apps/showcase/modules`
that holds an `expo-module.config.json` is built into the app. There is
nothing to register in `package.json` or `app.json`.

## What the Swift file does

`SwipeRowView.swift` has five parts.

**What it is made of.** The row holds two layers. The action tiles sit at
the back. The content sits in front: that is whatever Foldkit put inside the
row. React Native hands the row its children through two functions,
`mountChildComponentView` and `unmountChildComponentView`, and the row puts
them in the front layer.

**Props.** One small function for each thing JavaScript can set, such as
`setActions` and `setMode`. Each one does nothing if the value is the same
as before, so a redraw in JavaScript never disturbs a row that is open.

**The gesture.** A `UIPanGestureRecognizer` watches the finger.
`gestureRecognizerShouldBegin` lets it start only when the finger moves more
sideways than up or down, which leaves vertical drags to the list. While the
finger moves, `handlePan` shifts the front layer. When the finger lifts,
`finishPan` looks at where the row is and how fast it was going, picks open
or closed, and a spring carries the row there at the finger's speed. When
the pan starts, the row also tells React Native to let go of any button the
finger landed on.

**The tiles.** `layoutActions` places each tile by hand in the gap the
content leaves. In tiles mode they start stacked under the row's edge and
spread apart. Past the full-swipe point the phone ticks and one tile grows
to fill the gap.

**Accessibility and the group.** Each action is offered to VoiceOver as a
custom action on the row. A small list at the bottom of the file,
`SwipeRowRegistry`, knows every row in the app, so that opening one can
close the others in its group.

## What the Kotlin file does

`SwipeRowView.kt` has the same five parts in the same order. The parts that
differ:

- Android has no gesture recognisers. The row reads raw touches. In
  `onInterceptTouchEvent` it watches the finger without taking anything.
  Once the finger has moved further than the phone's "this is a drag"
  distance, and more sideways than up or down, the row takes the touch for
  itself. It then tells the list not to scroll
  (`requestDisallowInterceptTouchEvent`) and tells React Native to let go of
  any pressed button (`NativeGestureUtil.notifyNativeGestureStarted`).
- A `VelocityTracker` measures the finger's speed. A `SpringAnimation`
  carries the row to rest from that speed.
- Tiles show a word only. SF Symbols are Apple's and do not exist on Android.
- Actions are offered to TalkBack with `ViewCompat.addAccessibilityAction`.

## How props and events cross over

JavaScript sets props on the native view. They are plain data: text,
numbers, yes or no, and lists of those. Functions cannot cross.

| JavaScript (`nativeSwipeOptions`) | Native prop | What it is |
|---|---|---|
| `leading`, `trailing` | `actionsLeading`, `actionsTrailing` | Lists of `{ key, label, symbol, role, tint }` |
| `allowsFullSwipe` | `allowsFullSwipe` | yes or no |
| `mode` | `mode` | `tiles`, `strip` or `info` |
| `group` | `group` | text |
| `cornerRadius` | `cornerRadius` | number |
| `isEnabled` | `isEnabled` | yes or no |
| `layoutDirection` | `rowDirection` | `auto`, `ltr` or `rtl` |
| `closeSignal` | `closeSignal` | number. The row closes when it changes. |

The native view sends events back. Each carries a small piece of data.

| Native event | Data | Becomes |
|---|---|---|
| `onSwipeOpened` | `{ side }` | the Message from `onOpened(side)` |
| `onSwipeClosed` | nothing | the Message from `onClosed()` |
| `onActionTriggered` | `{ key, viaFullSwipe }` | the Message from that action's `onTriggered` |

Each name appears in three places that must agree: the `Prop("...")` or
`Events(...)` line in `FoldkitSwipeModule.swift`, the same line in
`FoldkitSwipeModule.kt`, and `packages/native/src/swipeNative/swipeNative.ts`.
A prop spelled differently in one of them is ignored without any error.

One function crosses too: `closeAll(group)` on the module closes every open
row of a group.

## The three lines on the Foldkit side

At startup, once (`apps/showcase/index.ts`):

```ts
registerNativeSwipe()
```

In a view:

```ts
nativeSwipeRow(
  [nativeSwipeOptions({ trailing: [swipeAction({ key: 'delete', label: 'Delete', role: 'destructive', onTriggered: () => DeletedMail({ id }) })] })],
  [content],
)
```

In a Command, to close open rows:

```ts
closeNativeSwipes('inbox')
```

Give the content a background colour. Without one the tiles show through.

Where the native view is missing, `nativeSwipeRow` draws a plain view with
the same content. Nothing swipes and nothing crashes. `isNativeSwipeAvailable()`
says which you have, and `nativeSwipeStatus()` gives the line the demo shows.

## Build and run the prebuilt app

### What to install (once)

For iPhone: Xcode from the Mac App Store, then open it once and let it
install what it offers. Your iPhone is on iOS 27, so take the newest Xcode.
`docs/DEV_BUILD.md` has the full list, with the steps on the phone itself
(Trust, Developer Mode).

For Android: Android Studio, opened once so it installs the Android SDK. Your
emulator already works, so this is done.

### iPhone

Connect the phone with a cable. In Terminal, from the project folder:

```
cd apps/showcase
npm install
npx expo prebuild
npx expo run:ios --device 2>&1 | tee build-ios.log
```

- `npx expo prebuild` creates the `ios` and `android` folders. They are
  generated. Git ignores them.
- `npx expo run:ios --device` compiles the app and puts it on the phone. It
  asks which device: pick your iPhone. It may ask which Apple account to
  sign with: pick yours.
- `2>&1 | tee build-ios.log` keeps a copy of everything the build prints in
  a file, `build-ios.log`. You need it if the build fails.

Then open the app on the phone and open **Swipe actions (native view)**.

### Android emulator

Start the emulator. Then:

```
cd apps/showcase
npx expo run:android 2>&1 | tee build-android.log
```

### How long it takes

These are estimates. Nobody has timed this project.

- First iPhone build: 10 to 30 minutes. It downloads and compiles every
  native library the app uses.
- First Android build: about the same.
- A build after changing only the Swift or Kotlin files: one to three
  minutes.
- Changing TypeScript needs no new build. The app reloads by itself.

### Does Expo Go still work?

Yes. `npm start` and Expo Go work as before. In Expo Go the demo's status
line says "Native view: not present: needs the prebuilt app, see
docs/NATIVE_VIEWS.md" and the rows do not swipe.

## If the build fails

The build prints thousands of lines. Only the first error matters. Later
ones are usually caused by it. To get the first few:

```
grep -n "error:" build-ios.log | head -20
```

For Android the lines start differently:

```
grep -E -n -A3 "^e: |FAILED|What went wrong" build-android.log | head -40
```

Send back what that prints. These are the errors most likely on a first
build, most likely first.

| What you see | What it means | What to send or do |
|---|---|---|
| Lines naming `SwipeRowView.swift` or `FoldkitSwipeModule.swift` with `error:` | A mistake in the Swift code. This is the expected kind: it was never compiled. | Send the `grep` output. Each line has the file, the line number and the complaint. |
| Lines starting `e: ` naming `SwipeRowView.kt` or `FoldkitSwipeModule.kt` | A mistake in the Kotlin code. | Send the `grep` output. |
| `Could not resolve androidx.dynamicanimation` | The Android build could not download the spring library. | Check the internet connection and run the command again. If it repeats, send the lines. |
| `Signing for "FoldkitShowcase" requires a development team` | Xcode does not know which Apple account to use. | Open `apps/showcase/ios/FoldkitShowcase.xcworkspace` in Xcode, click the project, Signing & Capabilities, choose your team. Run the command again. |
| `bundle identifier ... is not available` | The app's name is taken under another account. | See "The commands" in `docs/DEV_BUILD.md`. |
| A failure during `pod install` | CocoaPods, the tool that fetches iPhone libraries, stopped. | Send the last 30 lines of `build-ios.log`. |
| The build finishes but the status line says "not present" | The native code did not get into the app. | Send the status line in full. Then run `npx expo prebuild --clean` and build again. |
| The app closes when you open the demo or touch a row | A mistake that only shows when the code runs. | On iPhone: Settings, Privacy & Security, Analytics & Improvements, Analytics Data, the newest file starting `FoldkitShowcase`. Send it. On Android: run `adb logcat -d > crash.txt` right after the crash and send `crash.txt`. |

After a fix arrives, run the same build command again. You do not need
`npx expo prebuild` again unless files were added or removed.

## How this differs from `.ios.ts` and `.android.ts` files

A file named `thing.ios.ts` next to `thing.android.ts` is still TypeScript.
The bundler picks one of the two by platform. That is a way to write
different JavaScript for each phone. It runs in the JavaScript engine, it
works in Expo Go, and it needs no build. It can only use native code that
is already in the app.

A native view is Swift and Kotlin. It is compiled into the app, it needs
your own build, and Expo Go cannot run it. In return it can do what
JavaScript cannot: own a gesture from the first touch to the last, with no
delay, and use any part of the phone's own toolkit.

Use platform files when the two phones need different settings or different
calls into code the app already has. Write a native view when the feel of a
touch matters, or when the phone has a control that the app has no access
to yet.

## Writing another one

1. Copy `apps/showcase/modules/foldkit-swipe` to a new folder beside it.
2. Rename four things to your own names: the folder, the module name in
   `Name("...")` in both module files, the class names listed in
   `expo-module.config.json`, and the Kotlin `package` line with its
   matching folders.
3. In the two module files, list your props and events.
4. Write the view in the two view files.
5. On the Foldkit side, copy `packages/native/src/swipeNative` and change
   the names and props to match.
6. Run `npx expo prebuild` and build.

## What was checked, and what was not

Checked on the engineer's Linux machine:

- Expo finds the module for both platforms (`npx expo-modules-autolinking
  resolve` lists `foldkit-swipe` with its Swift class and its Kotlin class).
- `npx expo prebuild` runs for iOS and Android in a scratch copy, with
  `--no-install`, which skips the CocoaPods step that needs a Mac.
- The file Expo writes to load modules on iPhone names `FoldkitSwipeModule`.
- The Kotlin files compile with the Kotlin compiler (2.2.0) against
  Android's real class list (API 34). Expo, React Native and the two
  androidx libraries were replaced by hand-written stand-ins with the same
  function names, so a mistake in how those are used can still be there.
- The Swift files have no grammar errors, according to a parser. No Swift
  compiler was available, so nothing checked that the names and types fit.
- The JavaScript side passes its tests on a simulated phone, with and
  without the native view. The app type-checks and bundles.

Not checked:

- That the Swift compiles. That the Android build succeeds.
- Anything about how the row looks, moves or feels.
- VoiceOver and TalkBack.

The questions for the phone are in `docs/PHONE_CHECKLIST.md`, N1 to N10.
