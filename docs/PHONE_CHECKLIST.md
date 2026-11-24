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

1. Does the menu show eighteen rows: Notes, Navigation, Lists and motion, Chat,
   AI chat, AI chat on Legend List, Styling, Phone features, Keyboard dock,
   Object tracking, Glass, Worklets, Server state, Swipe actions,
   Swipe actions (native view), Sheets, Menus and controls, Voice notes?
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

Three demos: Chat, AI chat and Keyboard dock, and the keyboard part of AI chat
on Legend List. None of the answers below has been checked on a phone.

Chat and AI chat have a button at the top that reads "Keyboard: inset",
"Keyboard: following" or "Keyboard: simple". Each press goes to the next one.
They open on "inset", which is new: the messages keep their full height, the
text field lies over the bottom of them, and the list scrolls to make room.
Use "inset" unless a question names another setting.

AI chat also has "Show numbers". Press it before you test. It puts two lines
of small white text on a dark strip over the messages. If an answer below is
no, take the screenshot with that strip showing.

The six that tell us most, on an iPhone, in AI chat:

C1. Type a question and press Send. Does your question move to near the top
    of the screen? If no, screenshot it with the numbers strip showing.
C2. Does the question stay still while the answer is written under it?
C3. When the answer is finished, tap the text field. Does the question stay
    exactly where it is while the keyboard comes up?
C4. Drag the messages down a little to put the keyboard away. Does the
    question stay exactly where it is?
C5. Scroll up and down through the messages with the keyboard down, then with
    it up. Is the scrolling smooth, with no shaking?
C6. Does the last grey line at the top say "The messages are not resized"? If
    it says "inset is not possible here", write down the words in brackets.
    In that case this phone is using "following" and C3 to C5 test that.

AI chat, more, on an iPhone:

C7. Open AI chat. Is the end of the last answer at the bottom, just above the
    text field, and not hidden behind it?
C8. Is the text field clear of the thin bar at the very bottom of the screen?
C9. Tap the text field before you send anything. Does it move up together
    with the keyboard, as if stuck to it?
C10. With the keyboard up, can you still see the end of the last answer above
     the text field? Did it get there smoothly, without a jump?
C11. Close the keyboard. Does the last answer come back down smoothly?
C12. With the keyboard up, drag the messages down slowly. Does the keyboard
     follow your finger, with the text field staying on top of it?
C13. Press "Ask a sample question" and wait. When the answer gets longer than
     the screen, does a round button appear at the bottom right, above the
     text field and not behind it?
C14. Touch the empty area under a short answer and drag. Do the messages
     scroll?
C15. Is there a blurred band across the messages just above the text field
     or the keyboard? Say yes if you see one.
C16. Scroll to the very end. Does the scroll bar at the right stop at the
     text field, and not run behind it?

The "Lift" button in AI chat. It only shows with "Keyboard: inset". Each
press goes to the next: whenAtEnd, persistent, always, never.

C17. "Lift: whenAtEnd". Scroll up into older messages and tap the text field.
     Do the messages stay where they are, with the keyboard covering the
     lower ones?
C18. "Lift: persistent". Scroll up into older messages and tap the text
     field. Do the messages move up with the keyboard? Close the keyboard. Do
     they stay up?
C19. "Lift: always". Same again. Do the messages move up with the keyboard
     and come back down with it?
C20. "Lift: never". Go to the end and tap the text field. Does the keyboard
     cover the last messages, and can you scroll to see them?
C21. In each of the four, repeat C3 and C4. Does the question at the top stay
     still every time?

Chat, on an iPhone:

C22. Open Chat. Is the newest message ("Type below and press Send.") at the
     bottom, just above the text field, with nothing cut off?
C23. Tap the text field. With the keyboard up, is the newest message still
     just above the text field?
C24. Type a message and press Send. Does Send react to the tap, and does your
     message appear just above the text field?
C25. A reply comes a second later. Can you see all of it above the text
     field?
C26. Press "Short chat". Do the two messages sit just above the text field?
     Tap the text field. Do they move up with the keyboard?
C27. Press the "Keyboard:" button. Do its words change, and are your messages
     still there with the newest at the bottom?
C28. Set it to "Keyboard: following", then "Keyboard: simple". In each, does
     the text field end up right on top of the keyboard, with the newest
     message just above it?
C29. Which of the three feels best when the keyboard opens and when you
     scroll? Tell us in your own words.

Keyboard dock, on an iPhone:

C30. Open Keyboard dock. Does the orange line say "Mode: following the
     keyboard natively"? If not, write down what it says.
C31. Tap the text field. Does the grey bar sit right on top of the keyboard,
     with no gap?
C32. With the keyboard up, scroll the list to its end. Can you see all of
     "Line 1" above the bar?
C33. If there is a "Use the fallback" button, press it and tap the text field
     again. Does the bar still end up on top of the keyboard?

On an Android phone. "Inset" is not built for Android, so the grey line will
say it is not possible and the phone uses "following".

C34. Chat: tap the text field. Does it sit right on top of the keyboard, with
     messages showing above it? Say no if there is an empty gap between the
     text field and the keyboard, or if no messages show.
C35. The same in AI chat, in AI chat on Legend List and in Keyboard dock.
     Does the text field sit right on top of the keyboard each time, with
     the list showing above it?
C36. Press the "Keyboard:" button to "simple" and try C34 again. Still no
     gap?
C37. Chat and AI chat: with the keyboard up, is the newest message just above
     the text field? Then drag the messages. Does the keyboard go away?
C38. If the text field stays hidden behind the keyboard for a moment and then
     jumps up, tell us. That is this phone not making room by itself.

AI chat on Legend List, on an iPhone:

C39. Press "Show numbers", type a question and press Send. Does your question
     move to near the top? Wait two seconds, then screenshot it either way.

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

## Worklets

A worklet is a small piece of code that runs on the thread that draws the
screen, so it keeps going while the rest of the app is busy. This demo has
not been seen on a phone. Its status lines are the main thing: they say
which pieces Expo Go has. See `docs/WORKLETS.md`.

W1. What does each of the six status lines under "1. What this build can do"
    say? Write them down in full, or send a screenshot. Wait three seconds
    first, so no line still says "waiting".
W2. Is the grey bar under the status lines short (about as wide as a
    fingertip is tall) or about four times that?
W3. Under "2. Block JavaScript", is there an orange box moving from side to
    side on its own? Is the blue box under it moving too?
W4. Press "Block JavaScript for 2 seconds". While the button is stuck, does
    the blue box stop? Does the orange box keep moving smoothly?
W5. When the button comes back, what number does the line under it give for
    how long JavaScript was blocked?
W6. Under "3. Drag the card", drag the orange card sideways. Does it stay
    under your finger with no lag?
W7. Let go of the card far from the middle. Does it spring back, and does
    the line under it say "Messages from releases: 1"? Let go close to the
    middle. Does the count stay the same?
W8. Leave the demo with Exit, open it again, and repeat W4. Is it the same,
    with no crash and no red box on the menu?

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

## Swipe actions

Rows you drag sideways to show actions behind them. It has not been seen on
a phone. Do SW1 first: it says which of the two ways of moving the rows the
phone is using. Then do SW2 to SW11 once that way, press the other name at
the top ("UI thread" or "JavaScript"), and do them again. See
`docs/SWIPE_ACTIONS.md`.

SW1. Open "Swipe actions". After a second, what does the line that starts
     "In use:" say? Is there a red line under it? Write both down in full.
SW2. In the Inbox, drag the first mail slowly to the left. Does the mail stay
     under your finger, and do two separate rounded tiles (Flag, then a red
     Delete) come out from under its right edge and spread apart?
SW3. Let go when it is more than half open. Does it stay open with both tiles
     fully showing and a gap between them, with no jump?
SW4. Close it with a tap on the mail. Now flick it left with a short, quick
     movement. Does it open? Flick it right the same way. Does it close?
SW5. Tap the small "Tap" button in a mail. Does "Taps on the small buttons"
     go up by one? Now put your finger on that button and drag left. Does the
     mail swipe open, with the count staying the same?
SW6. Put your finger on a mail and scroll the page up and down. Does the page
     scroll with no mail moving sideways? Open a mail, then scroll the page.
     Does the mail close?
SW7. Open the first mail, then start dragging the second. Does the first one
     close? Open one and tap an empty part of the page. Does it close?
SW8. With "Full swipe: on", drag a mail left almost across the screen and
     hold. Does the red tile grow over the grey one, with a small tap from
     the phone as it does? Drag back a little. Does it shrink back?
SW9. Drag across again and let go. Does the mail slide away, and does a line
     with an Undo button appear? Press Undo. Is the mail back in its place,
     closed?
SW10. Under Tasks, drag a row left. Do three flat coloured blocks with no
      gaps (Rename, Pin, Delete) fill the space behind it, each the full
      height of the row?
SW11. Under Chat, drag a bubble left. Does a time slide in on the right, and
      does the bubble spring back when you let go, with "Last event" not
      changing?
SW12. Press "Right to left: off" so it says on. Does dragging a mail to the
      right now show Flag and Delete on the left side? With VoiceOver on,
      does a mail offer Read, Delete and Flag as actions? (Swipe up or down
      on the mail to hear them.)

## Swipe actions (native view)

Inbox rows drawn and moved by this project's own Swift and Kotlin code. It
needs an app you build yourself (`npx expo run:ios --device`, or
`npx expo run:android`). Expo Go cannot run it. The native code has never
been compiled, so the first build may stop on an error. See
`docs/NATIVE_VIEWS.md`.

N1. Did the build finish and put the app on the phone? If not, paste the
    first error. `docs/NATIVE_VIEWS.md`, "If the build fails", says how to
    find it.
N2. Open "Swipe actions (native view)". What does the orange status line at
    the top say? ("Native view: present" is right in your own build. In Expo
    Go it should say "not present: needs the prebuilt app", and the rows
    should show but not swipe.)
N3. Drag a row slowly to the left. Do Delete and Flag come out from under
    the row's right edge and spread apart, with the row staying under your
    finger? Let go past half way: does it stay open? Flick a closed row
    left with a short quick move: does it open too?
N4. Drag a row all the way to the left. Does Delete grow to fill the row,
    and do you feel a tick? Pull back a little: does it shrink again? Go all
    the way and let go: is the mail gone, and does the line say "Last
    event: Delete on mail-1, by a full swipe" (with that row's number)?
N5. Open one row. Start dragging another. Does the first one close?
N6. Put a finger on a row and move it up and down. Does the list scroll as
    usual, with no row sliding sideways?
N7. Press the grey "Press me" button in a closed row. Does its number go up
    by one? Now start a swipe with your finger on that button. Does the row
    slide and the number stay the same? Tap the content of an open row. Does
    it close, with the number still the same?
N8. Drag a row to the right. Does Read show on the left? Press it. Does the
    blue dot turn grey? Press "Direction". Do the sides swap, so that Delete
    and Flag now come from the left?
N9. Press "Look: Strip". Are the actions square blocks from edge to edge?
    Press "Look: Info". Does dragging left show two lines of grey words,
    and does the row spring back when you let go, with nothing triggered?
N10. Turn on VoiceOver (iPhone) or TalkBack (Android) and move to a row.
     Does it say actions are available, and can you choose Delete, Flag and
     Read from them?

## Sheets

Bottom sheets: panels that slide up from the bottom edge. Each one is the
phone's own sheet. The main screen has a counter, a "Last event" line and a
list of buttons, one per sheet. None of this has been seen on a phone. Please
answer each question for the iPhone and for Android.

SH1. Open "Maps-style sheet". Does it come up to about a quarter of the
     screen? Drag it to half and to full. Each time, does the line "Maps-style
     sheet: resting at ..." on the main screen name the right height?
SH2. With that sheet at small or half: is the main screen behind it bright,
     can you scroll the colours, and does "Add one" raise the counter? At
     full, is the screen behind dimmed?
SH3. With that sheet open, press "Move to half", then "Move to small" on the
     main screen. Does the sheet end at the right height each time? Say what
     you see on the way: it is expected to slide away and come back.
SH4. Open "Sheet that fits its content". Does the sheet end just under the
     last button? Press "Add a line" three times. Does the sheet grow each
     time, with nothing cut off?
SH5. Open "Sheet with a text field" and tap the field. With the keyboard up,
     can you see both the field and the Send button, just above the keyboard?
     Type a word and press Send. Does it appear in the sheet?
SH6. Still there: drag the sheet to full height and tap the field again. Are
     the field and Send still just above the keyboard?
SH7. Open "Sheet with a 500-row list". Scroll down and back up. Is it smooth?
     At the top of the list, pull down. Does the sheet move down with your
     finger? At half height, push up. Does the sheet go to full?
SH8. Open "Sheet with a footer". Are Cancel and Save at the bottom edge of
     the part of the sheet you can see, at half and at full, and while you
     drag between them? Does Save raise the number beside it?
SH9. Open "Sheet that asks before closing". With the field empty, drag the
     sheet down. Does it close? Open it again, type a word, and drag it down.
     Does the sheet stay, or come straight back, with the question "Throw
     away what you typed?" and your word still in the field?
SH10. Open "Sheet over a sheet" and press its button. Is the second sheet
      lying over the first? Drag the second one down. Is the first still
      open and usable?
SH11. Open "Sheet with screens inside". Is there a title bar inside the
      sheet? Press "Push a screen". Does a new screen slide in inside the
      sheet, with a back button that works? On Android, say if this one
      crashes or looks broken: its sheets are not built to hold screens yet.
SH12. Look at any of the sheets. Does it have round top corners and a small
      "drag me" bar at the top? On an iPhone with iOS 26 or later, does the
      Maps-style sheet say "a glass panel", and is it see-through glass?

## Menus and controls

The phone's own menus and controls, with no React. A block at the top,
"What this phone uses", has one line per feature. Green lines are the
phone's own. Amber lines are a fallback and say why. None of this has been
seen on a phone. Please answer on the iPhone and on the Android emulator.

MC1. Open "Menus and controls". Please send a screenshot of the block "What
     this phone uses". Are the lines green, and do they say "Expo UI
     (SwiftUI)" on the iPhone and "Expo UI (Jetpack Compose)" on Android?
MC2. Is the whole screen drawn, with nothing missing, cut off or on top of
     something else? Can you scroll to "Set from the Model" at the bottom?
MC3. Press and hold the grey card. iPhone: does the card lift and a menu
     open, with icons, a greyed "Print (off)" and a red "Delete"? Android:
     does a menu open under the card?
MC4. Choose "Pinned" in that menu. Does "Last event" say "Card menu: pin",
     and does the card say "Pinned"? Open the menu again. Is there a check
     mark by "Pinned"? iPhone only: does "Move to" open a second menu?
MC5. Press "Sort". Does a menu open at the button? Choose "Name". Does the
     line beside it say "Sorted by name", and is "Name" checked next time?
MC6. Press "More" in the title bar. Does a menu open from the bar? Choose
     "Rename". Does "Last event" say "Title bar menu: bar-rename"?
MC7. Press "Open an action sheet". iPhone: does a sheet slide up with a red
     "Remove photo", a greyed "Browse files (off)" and Cancel? Android: does
     a dialog with a list open? Choose one. Does "Last event" name it?
MC8. Flip the switch and drag the slider. Do they move under your finger
     with no jump back, and do the lines under "In the Model now" follow?
     Does the progress bar follow the slider?
MC9. Tap a segment, and the stepper's plus and minus. Do the lines under
     "In the Model now" follow each tap? Does the stepper stop at 0 and 10?
MC10. Change both pickers. iPhone: is one a menu and the other a wheel?
      Android: are both menus? Do the lines in the Model follow?
MC11. Change the date and the time. Do "Date" and "Time" in the Model show
      what you picked? On Android, is the day right and not one day off?
MC12. Press "Set from the Model". Do all the controls move by themselves to
      the new values (switch on, slider near the right, "Large", 7, "Blue",
      "Fig", 2027-01-31, 18:45)? Press it again. Do they all move back?

## Voice notes

The demo "Voice notes" records with the microphone, keeps each note as a file
on the phone, and plays it back. It has not been seen or heard on a phone.
See `docs/VOICE_NOTES.md` for what the words on screen mean. Please answer
for the iPhone and for Android separately where they differ.

V1. Open "Voice notes". What do the four lines under Status say? (Route
    should say "expo-audio native objects, no React". If it says "not
    available", write down the rest of the line and stop here.)
V2. Press the round Record button. Does the phone ask for the microphone?
    Allow it. Did you feel a tap, and does the button show a timer counting
    up from 0:00?
V3. Talk, then stay quiet. Do the bars under the button rise when you talk
    and fall when you stop? Does the rest of the screen stay still while
    they move?
V4. Press Pause, wait five seconds, press Resume. Did the timer wait and then
    carry on from the same number?
V5. Press "Stop and save". Did you feel a second tap, and is there a note in
    the list with a length, a size and today's date? Press Play. Can you
    hear all of it, including the part after the pause?
V6. While it plays, press a block in the row of blocks to jump, then press
    1.5x and 2x. Does the sound jump and speed up? Does it stop at the end
    with the position back at 0:00?
V7. Press "Record 5 seconds and stop" and do not touch the phone. Does a
    warning line show near the end, and does a five second note save itself?
V8. Record a few seconds and press Discard. Is the list unchanged? Then
    rename a note and delete a note. Close the app from the app switcher and
    open it again. Is the list as you left it, and do the notes still play?
V9. Start a recording and talk for two minutes with the app in the
    background: go to the home screen and leave it there. Come back. What
    does the timer say, and does the phase line say "Recording" or "Paused
    by the phone"? Stop and play it. How much of the two minutes can you
    hear?
V10. Start a recording, lock the screen, and talk for two minutes. Unlock.
     Same three answers as V9: the timer, the phase line, and how much you
     can hear. On Android, was there a notification while it recorded?
V11. Start a recording, press Exit, open another demo, then come back to
     "Voice notes". Is the timer still running at the right second, and does
     the saved note hold everything you said?
V12. Start a recording and call the phone from another phone (or start a
     timer alarm). Does the phase line say "Paused by the phone"? After the
     call, does it carry on by itself, or do you need to press Resume? Then,
     in the phone's Settings, turn the microphone off for the app, come back
     and press Record. Does an "Open Settings" button appear, and does it
     open the right page?
