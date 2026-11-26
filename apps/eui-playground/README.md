# EUI Playground

A small app that runs Effect UI on the phone's own views. React draws
nothing. It has eight screens, picked from a menu, and it exists to answer
questions on a real phone: does a long list scroll well, do touches behave,
does data from a server load and save as it should, and do animations keep
running while the app's own code is busy.

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

## Eighteen checks

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

The last four are on the Motion screen. It needs no new build if you built
this app before: the packages it uses were already in it.

15. **Which way animations run.** Tap Motion. Read the first line. Does it
    say "Animations run: on the phone's own thread"? (If it says "set at
    once", write down the reason in the brackets. The boxes will jump, and
    checks 16 and 17 cannot be answered.)
16. **Fade, move, spring.** Tap Run. Does the black box fade, the blue box
    slide to the right, and the red box slide, grow and swing a little past
    its end before it settles? Does the grey box fade too? Tap Run again:
    do all four go back?
17. **JavaScript blocked.** Tap "Run, and block JavaScript for one second".
    For that second the app's own code does nothing. Do the black, blue and
    red boxes keep moving smoothly the whole time? Does the grey box stand
    still for about a second and then jump or hurry on? Afterwards, does
    the line under the buttons say "JavaScript was blocked for" and a
    number near 1000?
18. **A line that comes and goes.** Tap "Show a line". Does a line of text
    rise in and fade in? Tap "Take the line away". Does it fade out, and
    not just vanish?

## What is in it

| Screen | Program | What it shows |
|---|---|---|
| Counter | `playground/counter.ts` | The smallest component |
| Notes | `playground/notes.ts` | A text field tied to the Model, a list, a second screen |
| Long list | `playground/longList.ts` | 1,000 rows, the window in the Model, a readout |
| Touch tests | `playground/touch.ts` | Press, hold, a button in a row, a list the app scrolls |
| Phone | `playground/phone.ts` | Haptics, clipboard, keyboard, colour scheme, app state |
| Server state | `playground/serverState.ts` | A list from a pretend server: load, add, delete at once, a save that fails |
| Motion | `playground/motion.ts` | Boxes that fade, move and spring on the phone's own thread, and a button that blocks JavaScript for a second |
| Snake | `playground/snake/SnakeGame.ts` | Effect UI's Snake game with its rules unchanged, on an old handset with a keypad |

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

## Snake: eleven checks

Added later. It needs no new build if you built this app before: it uses
only what was already in it. Run `npm install` once after pulling, or just
start the app again from the Mac.

Snake is Effect UI's own example game. The rules are the same files the
browser and terminal versions use. The screen is new: an old handset with a
small green screen and a number keypad. 2, 4, 6 and 8 steer. 5 starts and
pauses. 0 starts a new game. The board has no walls: the snake comes back in
on the other side. The game ends when the snake runs into itself.

Answer yes or no, or write the number down.

19. **It opens.** Tap Snake in the menu. Do you see a grey handset on a dark
    ground, a green screen with a three-square snake and a round apple, the
    words "PRESS 5" in a box, and twelve keys?
20. **The keypad steers.** Tap 5. The snake moves to the right. Tap 2: does
    it turn up? Then 4 (left), 8 (down), 6 (right). Does each key dim under
    your finger, and do you feel a light tap for each?
21. **Turning straight back does nothing.** While the snake goes right, tap
    4. Does it keep going right?
22. **A swipe steers.** Swipe up, down, left and right on the green screen.
    Does the snake turn each time, soon after your finger starts to move?
    Does a swipe to the right ever pull the whole screen back to the menu?
23. **It moves evenly.** Play for half a minute and watch the snake. Does it
    move in even steps, with no stutter? Write down the four numbers in the
    small line under the handset: the two after "JS frame" and the two after
    "Last tick".
24. **Eating.** Run over the apple. Is the snake one square longer, does the
    score at the top left go up by 10, and does a new apple appear?
25. **Dying.** Eat two or three apples, then turn in a tight circle into
    your own tail. Does the snake stop, do the words "GAME OVER" show, and
    does the number beside the crown at the top right show your score?
26. **Pause.** In a game, tap 5. Does the snake stop and "PAUSED" show? Tap
    5 again: does it go on from the same place?
27. **New game.** Tap 0. Is the snake back in the middle, the score 0000,
    and the number beside the crown still your best?
28. **The numbers switch.** Tap "Numbers: on" at the bottom right. Does the
    line of numbers go away, and come back when you tap again?
29. **How it looks on your phone.** Is anything cut off at the top, the
    bottom or the sides? Are the keys big enough to press without looking?
    Are the squares of the board sharp and all the same size? Is the bottom
    row of keys clear of the home bar? Turn on dark mode: does the screen
    look the same?
