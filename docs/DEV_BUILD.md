# Making a development build of the showcase

This is for someone with a Mac and an iPhone who does not write code.

## Why you might need one

Until now the showcase ran inside Expo Go, an app from the App Store that
already contains a fixed set of native code. A development build is your own
copy of the showcase app, built on your Mac and installed on your phone. It
can contain native code that Expo Go does not have.

The keyboard dock (the text field that rides on the keyboard) has two ways of
working:

- **Following the keyboard natively.** The phone moves the bar on every frame
  of the keyboard's movement, also while you drag the keyboard down with a
  finger. This needs the native half of a library called
  react-native-keyboard-controller. iPhone only.
- **Fallback.** The app hears the keyboard's height once and eases the bar to
  its place over a quarter of a second. This works everywhere.

## Try Expo Go first

Expo's documentation for SDK 58 lists react-native-keyboard-controller as
"Included in Expo Go". If that holds on your phone, you do not need a
development build for the dock at all.

1. Start the app as you always do: in `apps/showcase`, run `npm start`, and
   open it in Expo Go.
2. Open the demo called **Keyboard dock**.
3. Read the orange line near the top.

| The line says | What it means |
|---|---|
| Mode: following the keyboard natively | The native code is there. No development build needed. |
| Mode: fallback (react-native-keyboard-controller is not in this build) | Expo Go on this phone does not have it. Make a development build. |
| Mode: fallback (native following is built for iOS only) | You are on Android. A development build will not change this. |
| Mode: fallback (the app did not pass nativeAnimated to configureKeyboardDock) | A setup step in `apps/showcase/index.ts` is missing or failed. Tell an engineer. |

The same line tells you the mode inside a development build.

When the line says "natively", the demo also shows a button, **Use the
fallback**, so you can compare the two on the same phone.

Nobody has run this on a phone yet. It was built and tested on a simulated
phone, which cannot show movement.

## What to install on the Mac (once)

1. **Xcode**, from the Mac App Store. It is a large download (many
   gigabytes). Allow an hour or more. Open it once, accept the licence, and
   let it install the iOS components it offers.
2. **Xcode's command line tools.** In Terminal: `xcode-select --install`. If
   it says they are already installed, good.
3. **An Apple ID in Xcode.** Xcode, Settings, Accounts, the plus button. A
   free Apple ID is enough to put the app on your own phone. With a free
   account the app stops opening after 7 days and you build it again.
4. **Node.js.** You already have it if `npm start` works.
5. **CocoaPods.** The build offers to install it the first time. Say yes.

On the iPhone (once):

1. Connect it to the Mac with a cable and tap **Trust** on the phone.
2. Turn on Developer Mode: Settings, Privacy & Security, Developer Mode. The
   phone restarts. (The switch appears after the phone has been connected to
   a Mac with Xcode open.)

## The commands

Run these in Terminal, one at a time, from the project folder.

```
cd apps/showcase
npm install
npx expo install react-native-keyboard-controller react-native-reanimated react-native-worklets
npx expo prebuild
npx expo run:ios --device
```

What each does:

- `npm install` fetches the app's JavaScript packages. You have done this
  before.
- `npx expo install ...` adds the keyboard library, in the version that
  matches this Expo version. The other two names are packages the keyboard
  library asks for. Naming them here makes Expo pick matching versions. Left
  out, a newer version is fetched that Expo 58 was not made for.
- `npx expo prebuild` creates two folders, `ios` and `android`, holding the
  native projects. They are generated, and git is told to ignore them.
- `npx expo run:ios --device` builds the app and installs it on the phone. It
  asks which device to use: pick your iPhone. The first time, it may ask
  which Apple account ("team") to sign with: pick yours.

The first time you open the app, the phone may refuse and say the developer
is not trusted. Go to Settings, General, VPN & Device Management, tap your
Apple ID, and tap Trust.

If the build stops and says the bundle identifier is not available, the name
`dev.foldkitnative.showcase` is taken under another account. Change it in
`apps/showcase/app.json` (the `bundleIdentifier` line) to something of your
own, such as `com.yourname.showcase`, then run `npx expo prebuild` and the
last command again.

## How long it takes

These are estimates. Nobody has timed this project.

- Installing Xcode: an hour or more, mostly download.
- The first `npx expo run:ios --device`: plan for 10 to 30 minutes. It
  downloads the native libraries and compiles all of them.
- Later builds: a few minutes, because only what changed is compiled.
- Changing the app's JavaScript needs no new build. The app on the phone
  loads it from the Mac while `npx expo run:ios --device` is running. The
  Mac and the phone must be on the same Wi-Fi. Running that command again
  later is quick, because the build is reused.

You only need a new build after adding or updating a native library.

## Android

The command is `npx expo run:android`, with Android Studio installed and the
phone connected with USB debugging on. There is no reason to do it for the
keyboard dock today: on Android the dock always uses the fallback. Following
the keyboard on Android needs a native piece this project does not have yet.

## Does Expo Go still work afterwards?

Yes. `npm start` and Expo Go work as before. The install step adds three
lines to `apps/showcase/package.json`. With those three packages installed,
the app's JavaScript bundle came out byte for byte the same as without them,
because the app uses none of their JavaScript.

If you want to undo it: delete the three lines from `package.json`, run
`npm install`, and delete the `ios` and `android` folders.

## What was checked, and what was not

Checked on the engineer's Linux machine:

- The app type-checks and bundles for iOS and Android, with and without the
  three packages installed.
- `npx expo prebuild` runs and lists react-native-keyboard-controller among
  the native libraries it will link. (It was run with `--no-install`, which
  skips the CocoaPods step that needs a Mac.)

Not checked, because there is no Mac, Xcode or phone there:

- `npx expo install` itself (the machine could not reach Expo's servers; the
  same three versions were installed with `npm install` instead).
- That the Xcode build succeeds.
- Anything you can only see on a phone. See the questions in the engineer's
  report.
