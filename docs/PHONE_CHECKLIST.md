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

1. Does the menu show five rows: Notes, Navigation, Lists and motion, Styling,
   Phone features?
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
