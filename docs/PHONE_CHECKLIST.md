# Phone checklist

What only a real phone can show. Nothing here has been checked on a device
unless a line says so. Answer yes or no. For a no, a screenshot helps most.

Run the showcase:

```
cd apps/showcase
npm install
npm start
```

Close Expo Go fully before scanning the QR code, so the first load is a true
first load.

## First pass (5 minutes)

Do this before anything else. It tells us which demos work at all.

1. Does the menu show twelve rows: Notes, Navigation, Lists and motion, Chat,
   AI chat, AI chat on Legend List, Styling, Phone features, Keyboard dock,
   Object tracking, Glass, Server state?
2. Open each one. Does it show a screen, or go straight back to the menu with
   a red "The last demo crashed" box? Write down the message for any that crash.
3. Can you get back to the menu from each one?

## Menu and presses

4. Does a menu row turn grey while your finger is on it?
5. Start a scroll with your finger on a row. Does it scroll without opening?

## Notes (already passed on iOS 27, recheck after the changes)

6. Type fast, add a note, open it, swipe back. Does it all still work?
7. Does the grey Menu button go back to the menu?

## Navigation

8. Is there a tab bar with three tabs (Stack, Present, Bar), each with an icon?
9. Does tapping a tab switch at once, and does each tab keep its place?
10. Stack tab: push three screens, swipe back. Do "Depth" and the route list
    match what you see?
11. Several levels deep, tap the Stack tab again. Does it go back to level 1?
12. Is content clear of the title bar at the top and the tab bar at the bottom?
13. Present tab: do the modal and the sheet open? Does the sheet rest at half
    height with a grabber, and drag to full?
14. Swipe each one down. Does "Closed by the phone" go up by exactly one?
15. Do the two modal buttons give screens that look the same? If not, which
    looks right?
16. Bar tab: is there a plus button at the right of the title bar, and does
    each press raise the count?
17. Does "Large title" make the title large, with content still below it?
18. Does "Hide the bar" remove the bar and bring it back?
19. With block on: do swipe-back and the back button leave the screen open and
    raise "Back refused"?

## Lists and motion

20. Does the list scroll smoothly, with the orange count staying under about 40?
21. On a fast fling, do you see blank areas before rows appear?
22. Press "Go to row 2,500". Is row 2500 at the top?
23. From there, scroll up slowly. Do rows jump or jitter?
24. Fling upward. Does the fling stop dead or stutter?
25. Does reaching the bottom raise "End reached" by exactly 1?
26. Do "Add at top", "Remove first" and "Shuffle" update without a flash?
27. Pull down at the top. Does a spinner show, do three rows appear after about
    a second, and does the spinner stop?
28. Motion screen: does the box fade and slide without jumping?
29. Do chips fade in when added and fade out when removed?
30. Does the card follow your finger without lag, and ease back when released?

## Chat and keyboard

Three demos: Chat, AI chat and Keyboard dock. None of them has been seen on a
phone.

Chat and AI chat have a button at the top that reads "Keyboard: following" or
"Keyboard: simple". Pressing it switches between two ways of keeping the text
field above the keyboard. Where a question says "both settings", try it once
in each. If one setting is broken, tell us which one and carry on in the other.

Chat, on an iPhone:

C1. Open Chat. Is the newest message ("Type below and press Send.") at the
    bottom, just above the text field, with nothing cut off?
C2. Is the text field clear of the thin bar at the very bottom of the screen?
C3. Both settings: tap the text field. Does it end up right on top of the
    keyboard, with no gap and no part hidden?
C4. Both settings: with the keyboard up, is the newest message still just
    above the text field?
C5. Set the button to "Keyboard: following". Does the last grey line at the
    top say the text field "should travel up with the keyboard"? If it says
    "eases up" instead, write down the words in brackets. In that case a no
    for C6 and C8 is expected and is not a fault.
C6. Following: tap the text field. Does it move up together with the
    keyboard, as if stuck to it?
C7. Following: while the keyboard opens, do the messages at the top of the
    list stay on screen the whole time? Say no if that area goes blank for a
    moment.
C8. Following: with the keyboard up, drag the messages down slowly. Does the
    keyboard follow your finger, with the text field staying on top of it?
C9. Both settings: with the keyboard up, type a message and press Send. Does
    Send react to the tap, and does your message appear just above the text
    field?
C10. Both settings: a reply comes a second later. Can you see all of it above
     the text field?
C11. Both settings: drag the messages to put the keyboard away. Does the text
     field go back to the bottom, with the newest message still just above it?
C12. Press the "Keyboard:" button. Do its words change, and are your messages
     still there with the newest at the bottom?

AI chat, on an iPhone:

C13. Open AI chat. Is the end of the last answer at the bottom, just above the
     text field?
C14. Both settings: tap the text field. With the keyboard up, can you still
     see the end of the last answer above the text field?
C15. Both settings: type a question and press Send. Does the keyboard go away
     and the question move to near the top of the screen?
C16. Both settings: does the question stay still while the answer is written
     under it?
C17. Both settings: once the answer is finished, tap the text field. Does the
     question stay where it is at the top?
C18. Both settings: press "Ask a sample question" and wait. When the answer
     gets longer than the screen, does a round button appear at the bottom
     right, above the text field and not behind it?

Keyboard dock, on an iPhone:

C19. Open Keyboard dock. Does the orange line say "Mode: following the
     keyboard natively"? If not, write down what it says.
C20. Tap the text field. Does the grey bar sit right on top of the keyboard,
     with no gap?
C21. With the keyboard up, scroll the list to its end. Can you see all of
     "Line 1" above the bar?
C22. If there is a "Use the fallback" button, press it and tap the text field
     again. Does the bar still end up on top of the keyboard?

On an Android phone:

C23. Chat, both settings: tap the text field. Does it sit right on top of the
     keyboard? Say no if there is an empty gap between them. A gap about as
     tall as the keyboard is worth a screenshot.
C24. Chat and AI chat, both settings: with the keyboard up, is the newest
     message just above the text field? Then drag the messages. Does the
     keyboard go away?
C25. Keyboard dock: tap the text field. Does the grey bar sit right on top of
     the keyboard, with no gap?

## Styling

31. Does the screen look styled: white page, grey rounded cards, blue buttons?
32. Switch the phone to dark mode from Control Center. Do all colors change at
    once, and does "View runs" stay at 1?
33. Is the platform box blue with the iPhone sentence only?
34. Rotate the phone. Does the bar change color with "View runs" unchanged?
35. Are any single-word labels cut off?

## Phone features

36. Does the Live section fill in, or stay on "waiting for the phone"?
37. Do the haptic buttons produce taps you can feel, and do they differ?
38. Does Copy, then Paste, bring the text back?
39. Type in "Remember this", fully close Expo Go, reopen. Is the text back?
40. Does Share open the system share sheet?
41. Does "Open link" open the browser?
42. Does "Show alert" show a native alert, and does the screen name the button
    you pressed?
43. With a field focused, does the Keyboard line show a height, and does
    "Hide keyboard" put the keyboard away?
44. Leave the app and return. Does "App state so far" show background?
45. Turn on airplane mode. Does Network change to offline, then back?

## Reload that keeps your state (separate app)

This one needs you to edit a file, so it has its own app.

```
cd apps/devloop
npm install
npx expo start
```

46. Press + a few times, type something, add items.
47. Open `apps/devloop/src/demo.ts` in any text editor, find `EDIT_ME`, change
    the words in quotes, and save.
48. Do the new words appear on the phone without a full reload?
49. Are the count, the typed text and the items still there?
50. Does "Crash on purpose" show a red crash screen, and does saving the file
    again bring the app back with the same count?

## Android

Nothing in this project has run on Android. If you have an Android phone with
Expo Go, the first pass above is the most useful thing to try.

## AI chat on Legend List

This demo runs Legend List's own list code under Foldkit. It has not been seen
on a phone. Its text field uses the simple keyboard handling, so it will jump
up with the keyboard and not slide.

L1. Does it open showing the newest message, with no blank screen and no
    visible jump from the top?
L2. After Send, does your message move to just below the top of the list and
    stay still while the reply is written?
L3. While the reply is written, does anything flicker or shift?
L4. Scroll up a long way, then slowly back down. Do the messages stay steady?
L5. Scroll up and press "Load older". Does what you were reading stay where it
    was?
L6. Does "Go to latest" move smoothly to the bottom and stop there?
L7. Tap the text field. Does the bar end on top of the keyboard, and does the
    list still show the newest message?
L8. Fling fast up and down. Are there blank gaps?
L9. Does scrolling feel as smooth as in "Lists and motion"?
L10. Are the answers to L1 to L9 the same on Android?

## Object tracking

A tracking game. Dots sit in a dark square. A few blink orange, then all turn
white and move. When they stop, you tap the ones that were orange. It has not
been seen on a phone. Use the first settings (8 dots, 3 targets) unless a
question says otherwise.

M1. What does the orange line at the top say after "Drawing with:"? Write it
    down in full.
M2. Before you press Start, is the dark square there, square, and empty?
M3. Press Start. Do 3 dots blink orange for about 2 seconds, then turn white?
M4. Do the dots move smoothly, with no stutter and no jumps?
M5. Do the dots stay inside the square and turn back at its edges?
M6. When they stop, tap a dot. Does a blue ring appear round the dot you
    tapped, and not round another one?
M7. After your third tap, do right picks turn green and wrong picks red, with
    an orange ring round any target you missed?
M8. Scroll down to "Timing of the last trial". What are the numbers for
    frames drawn, late frames, and usual and worst frame time?
M9. On the same screen, what are the measured dot speed and the measured
    moving time? (Set: 140 points a second and 8000 ms.)
M10. Press "Replay same trial". Do the same dots blink and take the same
     paths as before?
M11. Set 20 dots and the highest speed, then press Start. Is the movement
     still smooth? Write down the late frames number again.
M12. If there is a button "Draw with plain views", press it and play a trial.
     Is it less smooth than before? Write down its late frames number.

## Glass

Liquid Glass is the see-through material of iOS 26 and later. The demo shows
a card, two shapes, a round button and a pill made of it, floating over
colours that scroll. It has not been seen on a phone. On Android, and on an
older iPhone, the same things are drawn as pale see-through boxes. That is
the fallback, and it is the right answer there.

G1. What does the orange line at the top say after "Liquid Glass:"? Write it
    down in full.
G2. Scroll the colours. Do they bend and blur through the card, the round
    button and the pill, as they do through the glass in Apple's own apps?
G3. Are the words on the glass easy to read over every colour?
G4. Press "Style: clear". Does the glass let more of the colours through?
G5. Press "Tint". Does the glass turn orange? Press it again. Does the
    orange go?
G6. Hold a finger on the round "+" button. Does the glass swell or shine
    under the finger? Does the number on the card go up by one when you let go?
G7. Press "Less" and "More" on the pill. Does the pill count change by one
    each time?
G8. Press "Shapes: close" so it says "Shapes: apart", then press it again.
    Do shapes A and B flow into one shape when close and part when apart?
G9. Press "Open the tabs screen" and scroll the list up. Does the tab bar
    shrink to a small pill, and is the Search button set apart from the
    other two? Does "Back to the glass screen" bring the first screen back?
G10. On the tabs screen, switch "Strip above the tab bar" on. Does a glass
     strip with the words "Strip above the bar" appear above the tab bar,
     with no crash?

## Server state

A crew list that comes from a pretend server inside the app. There is no
network. A panel at the top, "What just happened", says how the list and the
open member are doing. It has not been seen on a phone. See
`docs/SERVER_STATE.md` for what the words mean.

S1. Open "Server state". Does the List line say "loading", and about half a
    second later "fresh" with "200 members", with names in the list below?
S2. What number is on the Server line? (1 is right.) Does the age on the List
    line go up by one each second?
S3. Tap the third row, "Cleo Marlow". Tap "Back to the crew". Tap the third
    row again. Did the name show at once the second time, and is the number
    on the Server line 2?
S4. On the member screen, change the name and press Save. Does the big name
    change at once? Wait two seconds and go back. Does the third row of the
    list show the new name?
S5. Scroll the list to its end and back. Is it smooth, and is every row
    filled in?
S6. Press "Stale after" so it says 5 s. Wait until the List line says
    "stale". Go to the home screen and come back. Does the List line say
    "refreshing" and then "fresh", and does the Server number go up by one?
S7. Press "Edit from another device" on the list screen. Does the first row
    stay the same? Wait for "stale", leave the app and come back. Does the
    first row now say "Renamed elsewhere 1"?
S8. Open a member, change the name, press "Fail next request", then Save.
    Does the new name show for a moment, then the old name come back with a
    line that starts "Could not save"?
S9. Press "Announce topic" so it says off. Change the name, press Save, wait
    two seconds and go back. Does the list still show the old name? (Yes is
    right: this is what breaks without the topic.)
S10. On the member screen with the keyboard open, can you see the name field
     and the Save button, and is the panel clear of the title bar?
