# EUI Playground

A small app that runs Effect UI on the phone's own views. React draws
nothing. It has six screens, picked from a menu, and it exists to answer
questions on a real phone: does a long list scroll well, do touches behave,
and does data from a server load and save as it should.

Nobody has run this app on a phone yet. It was built and tested on a
laptop, where a simulated phone can check what the app asks for but cannot
show how it looks or feels.

## Build it on your iPhone

You need the Mac setup from `docs/DEV_BUILD.md` (Xcode, your Apple ID in
Xcode, the iPhone trusted and in Developer Mode). If Fold Chat built for
you, you have it all.

Connect the iPhone with a cable. In Terminal, from the project folder:

```
cd apps/eui-playground
npm install
npx expo prebuild --clean
npx expo run:ios --device 2>&1 | tee build-ios.log
```

- `npm install` fetches the app's packages. Effect UI is not in the public
  package store yet, so it comes from a file in this project
  (`packages/effect-ui-native/vendor`).
- `npx expo prebuild --clean` makes the `ios` and `android` folders fresh.
- `npx expo run:ios --device` builds the app and puts it on the phone. Pick
  your iPhone when it asks. The first build takes 10 to 30 minutes.
- `2>&1 | tee build-ios.log` keeps a copy of what the build prints, in case
  it fails.

The app is called **EUI Playground** on the home screen. If the phone says
the developer is not trusted: Settings, General, VPN & Device Management,
your Apple ID, Trust.

If the build says the bundle identifier is taken, open `app.json`, change
`dev.foldkitnative.euiplayground` in both places to something of your own,
and run the last two commands again.

Changing the app's TypeScript needs no new build: the app reloads from the
Mac while `npx expo run:ios --device` is running.

## Fourteen checks

Answer yes or no, or write the number down.

1. **First screen.** Does the menu appear by itself after the app opens,
   with the title "Effect UI Native" in the phone's own title bar?
2. **Counter.** Tap Counter. Tap Plus five times. Does the number read 5?
   Does each button dim while your finger is on it?
3. **Swipe back.** Swipe from the left edge. Does the screen slide away
   with your finger and the menu come back? Open Counter again: is the
   number back at 0?
4. **Notes, typing.** Tap Notes. Type a sentence fast. Does every letter
   arrive, in order, with no flicker? Keep typing past 40 letters: does the
   field stop at 40?
5. **Notes, second screen.** Tap Add, then tap the new note. Does a screen
   titled "Note" slide in with a Back button? Go back: is your note still
   in the list?
6. **Long list, numbers.** Tap Long list. Fling the list hard a few times.
   Write down the two "JS frame" numbers and the two "Last event" numbers
   at the top. Do you ever see blank space where rows should be?
7. **Long list, recycling.** Tap "Recycle: off" so it says on. Fling again.
   Write the same four numbers down. Does it feel smoother, the same, or
   worse?
8. **Hold while it streams.** Tap "Scroll to end", then "Stream: off" so it
   says on. The last row grows and the list follows it. Rest a finger on a
   row above it for a second. Does "holds" go up by one? Lift the finger:
   did "Presses" stay the same?
9. **Touch tests.** Tap Touch tests. Tap a row (Row presses goes up). Drag
   the list (it must not go up). Tap a blue Button (only Button presses
   goes up). Turn on "Auto scroll" and tap and hold rows while the list
   moves by itself: do presses and holds still count? Write down the two
   numbers in the "Host" line.
10. **Phone.** Tap Phone. Do "Light tap" and "Heavy tap" feel different?
    Tap Copy, then Paste: does the line show the copied text? Tap the
    field: write down the keyboard height it shows. Switch the phone to
    dark mode: does the screen turn dark and the line say "dark"?

The last four are on the Server state screen. Its server is a pretend one
inside the app. It takes about half a second to answer.

11. **The list loads.** Tap Server state. Do you see "Loading the list."
    for a moment, then Bread, Apples and Coffee? Does the top line say
    "List loaded 1 times. Now: loaded."?
12. **Delete does not flash.** Tap Delete on Apples. Does the row go at
    once, and stay gone? Watch for about two seconds: the row must not
    come back, not even for a blink.
13. **A failed save puts the row back.** Tap "Next save fails" so it says
    on. Tap Delete on Bread. Does the row go at once, then come back after
    about half a second, with "Not saved: The server said no." above the
    list?
14. **Leaving and returning loads again.** Note the number in the top
    line. Go to the home screen, then open the app again. Is the number
    one higher?

## What is in it

| Screen | Program | What it shows |
|---|---|---|
| Counter | `playground/counter.ts` | The smallest component |
| Notes | `playground/notes.ts` | A text field tied to the Model, a list, a second screen |
| Long list | `playground/longList.ts` | 1,000 rows, the window in the Model, a readout |
| Touch tests | `playground/touch.ts` | Press, hold, a button in a row, a list the app scrolls |
| Phone | `playground/phone.ts` | Haptics, clipboard, keyboard, colour scheme, app state |
| Server state | `playground/serverState.ts` | A list from a pretend server: load, add, delete at once, a save that fails |

The programs are in `packages/effect-ui-native/playground`. The app copies
them, with the host, into `./native` each time it starts
(`scripts/sync-eui-playground.sh`). `docs/EFFECT_UI_NATIVE.md` explains the
rest.

## Check it builds, without a phone

```
npm install
npx tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform ios --platform android --output-dir /tmp/eui-export
```

## Dev tools and the crash screen

Added later. Run `npm install` once after pulling. The app does not have to
be built again.

- **Dev tools.** `npm run devtools` in this folder starts a page on your
  Mac, at `http://127.0.0.1:4774`, that shows everything the running app
  does. `docs/DEV_TOOLS.md` has the steps and the checks.
- **The crash screen.** Open Phone and scroll to the bottom. Three small
  buttons break the app on purpose: in update, in view, in a Command. Each
  shows the crash screen, with Copy and Start again.
