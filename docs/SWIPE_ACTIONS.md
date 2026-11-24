# Swipe actions

Written for the project owner first. The notes for an engineer are at the
end.

Drag a row sideways and actions appear behind it. The source for what this
must do is the sketchnote of Kasper Lahti's talk "Building UI Components
with SwiftUI" (NSSpain 2023). This page goes through the sketchnote line by
line and says how each line is met, or that it is not.

**Nothing here has run on a phone.** The tests run on a simulated phone.
They prove the rules: what opens, what closes, what is triggered and how
often. They cannot show how it looks or feels. The "Swipe actions" section
of `docs/PHONE_CHECKLIST.md` (SW1 to SW12) is how we find out.

## What was built

- A row you can swipe: `swipeRow`, in `packages/native/src/swipe/`.
- Three styles: **tiles** (separate rounded tiles that come out from under
  the row and spread apart), **strip** (the classic flat coloured strip),
  and **info** (shows something passive, like the time a message was sent).
- Two ways to move the row, behind one API. They are called drivers.
  - **UI thread**: the finger is read and the row is moved on the thread
    that draws the screen, by worklets. It keeps up when JavaScript is busy.
    It needs the three native pieces `docs/WORKLETS.md` describes, and
    those have not been confirmed on a phone.
  - **JavaScript**: the same row moved from JavaScript, with the touch
    handling this project already runs on the iPhone. This is the one sure
    to run today.
  The row picks the UI thread when it can run and JavaScript when it
  cannot. The demo can force either, to compare them.
- A door for a third driver. Another folder can register its own (for
  example a row built from native views) and the same row options work
  with it.
- A demo, "Swipe actions", with an inbox, a task list and chat bubbles.

## The sketchnote, line by line

"Met" means built and covered by a test on the simulated phone, for both
drivers unless it says otherwise. It never means seen on a phone.

### Swipe actions are "the keyboard shortcut for phones"

Met. Every action a swipe offers is also reachable by pressing its tile and
by a screen reader, so the swipe is a shortcut and never the only way.

### The system version has lots of built-in behaviour. A custom one has to support a lot.

Met in part. The list below is what is supported. What the iPhone's own
version does and this does not: it does not confirm a destructive action
with a second tile, tiles show a text label and an optional one-character
glyph but no icon images, and there is no keyboard or pointer support.

### Should work for everyone: accessibility

Met in part.

- Each action is offered to a screen reader as a named action on the row
  (VoiceOver's "Actions" rotor, TalkBack's actions menu). Picking one sends
  the same Message as pressing the tile. Tested.
- Each tile has a spoken label and is marked as a button. Tested.
- The row is read as one thing by default, with a label the program gives
  it. That means a button inside the row is not reached on its own by a
  screen reader. A program can turn that off per row (`accessible: false`).
- Less motion: the row can jump to where it rests in place of springing
  (`reduceMotion`). Tested. **The project has no way yet to ask the phone
  whether the user turned "Reduce Motion" on.** The app has to pass it in,
  and the showcase app does not do that yet, so on the phone the row always
  springs.
- Not checked: colour contrast of the tiles, and text size. Tile labels do
  not wrap, so a very large text size will cut them off.

### 1. Gestures

**Cancellable.** Met. Drag back to where you started and let go: nothing
opens and nothing is triggered. If the phone takes the touch away (a call
comes in, a scroll starts), the row goes back to where it was resting.

**Priority over buttons inside the row.** Met. A tap on a button in the row
presses the button. A sideways drag that starts on that button swipes the
row and calls the press off. With the JavaScript driver the test drags from
the button itself. With the UI thread driver the test only shows that the
press is called off when the finger drifts. That the phone hands the drag
to the swipe is a phone question (SW5).

**Take velocity into account.** Met. A slow release goes by position: more
than half open stays open. A flick goes by direction, however short: a
quick flick opens a row that has barely moved, and a quick flick back
closes one that is nearly open. The spring that brings the row to rest
starts at the finger's speed.

**Remember right-to-left layout.** Met. With `rightToLeft` on, leading is on
the right and trailing on the left. The showcase app passes the phone's own
setting in, and the demo has a switch. The demo flips the layout inside its
rows itself. The component only flips the sides.

**Do not interfere with scrolling.** Met, with a phone question. A finger
that goes up or down first is never taken by the row, so the list scrolls.
A scroll closes an open row. With the JavaScript driver the list is held
still once a sideways swipe has begun. With the UI thread driver the
gesture gives up after 10 points up or down. Whether a diagonal drag feels
right is SW6.

### 2. Actions

**Full swipe to trigger an action.** Met. With `allowsFullSwipe`, dragging
past a line (a bit over half the row) makes the action at the outer edge
grow over the others. Let go there and it is triggered, once. Drag back
first and it is not. A Message says when the line is crossed, and the demo
uses it to tap the phone (a haptic). A destructive action slides the row
away before the program hears. Any other action closes the row.

**Different roles and styles (destructive, cancel, normal).** Met. An action
has a role, and the style colours each role. An action can also carry its
own colour (`tint`).

### 3. Behaviours

**Only one open at a time.** Met. Rows share a group. Opening one, or
starting to drag one, closes the others in its group. A tap anywhere else
closes it. A tap on the open row itself closes it and presses nothing
inside. Scrolling closes it. A program can close one row or all of them
with a Command.

### 4. Styling

**An API similar to button styles.** Met. A style is a value you pass to
the row: `style: tiles`. `swipeStyle(tiles, { ... })` makes a new one from
an old one.

**Animation.** Met. Springs, on whichever thread drives the row.

**Layout.** Met. The heart of a style is one function: given how far the
row has moved, where is each tile and how wide. Writing that function is
writing a new look. A test does it.

**Show information instead of actions.** Met. `swipeInfo(...)` puts
anything behind the row. With the info style the row springs back and
nothing is triggered. The demo shows the time behind chat bubbles.

### The look in the screenshots

Built, not seen. The tiles style draws each action as its own rounded
shape with a gap, and the row itself as a rounded pill. As the row moves,
the tiles come out from under its edge stacked like cards and spread apart.
On a full swipe one tile grows to take over. The colours and sizes are our
own. Whether it looks right is SW2 and SW3, and it will likely need tuning
by eye.

## Inside a list

Works in a plain scroll view and in this project's long `list`. A row that
scrolls off the screen is removed. When it comes back it is closed. Tested
in both.

The demo uses a plain scroll view, because its three sections share one
screen.

---

# For an engineer

## Files

| File | What |
|---|---|
| `src/swipe/types.ts` | Options, actions, roles, styles, events. Shared by every driver. |
| `src/swipe/core.ts` | The rules as functions of numbers. Worklets, used by both drivers. |
| `src/swipe/styles.ts` | `tiles`, `strip`, `info`, `swipeStyle`. |
| `src/swipe/drivers.ts` | The driver registry. |
| `src/swipe/group.ts` | One open row per group. `closeSwipe`, `closeAllSwipes`. |
| `src/swipe/row.ts` | `swipeRow`: what is drawn. Registers the two drivers. |
| `src/swipe/stage.ts` | What a row keeps between draws. |
| `src/host/swipe/rows.ts` | Touch, motion and events between draws. |
| `src/swipe/uiSide.ts` | The UI thread driver's worklets. |
| `test/swipe.ts`, `test/swipe.test.ts` | A fixture and 105 tests. |
| `test/demos/swipe.ts` | The demo. |

## Adding a driver

    registerSwipeDriver('native', {
      label: 'Native',
      check: () => ({ ok, reason }),
      row: (h, spec, children) => Html,
    })

`spec` is a `SwipeRowSpec`: the row's options with defaults filled in. The
driver's row raises four native events on the view it returns and puts
`swipeEventAttributes(spec)` on that view to turn them into Messages:

    swipeOpened     { side: 'leading' | 'trailing' }
    swipeClosed     {}
    swipeTriggered  { key, side, isFullSwipe }
    swipeArmed      { isArmed, side }

A native view only has to emit `topSwipeOpened` and so on with those
payloads. `swipeAccessibilityAttributes(spec)` gives the screen reader
props. `joinSwipeGroup({ group, id, isOpen, close })` and
`closeOtherSwipes(member)` put the row under the one-open rule and within
reach of `closeSwipe`.

`'auto'` tries `['ui-thread', 'javascript']`. A new driver is only chosen
by name, unless the app calls `setSwipeDriverOrder`.

## What changed in the worklets folder

All additive.

- `uiThread({ panConfig })`: `activeOffsetX`, `activeOffsetY`,
  `failOffsetX`, `failOffsetY`, `minDist`, `hitSlop`, `enabled`. Sent to
  gesture-handler under its native names (`activeOffsetXStart` and so on).
- `gestureTag()`, `uiThread({ panTag, panRelations })` and
  `uiThread({ nativeGesture })`: gives gestures numbers and relates them
  (`configureRelations`). The swipe row uses this only when a program passes
  `scrollGesture`. Never run on a phone.
- `springTo(value, to, { velocity })`: a starting speed.
- `PAN_BEGAN`, `PAN_CANCELLED`, `PAN_FAILED`.

Velocity was already in pan events. No timing or decay animation was
needed.

## Limits and stubs

- The UI thread driver animates `width` on tiles from the UI thread. That
  is a layout prop, so each frame of a swipe lays the row's tiles out
  again. Fine for a few tiles. Unmeasured.
- A view the UI thread has moved stays under its control. Changing driver
  therefore remakes the row's moving views (they get a new key).
- A custom style's `tile` and `openWidth` must be worklets for the UI
  thread driver. If `tile` is not, that row uses the JavaScript driver.
- On Android the UI thread driver needs a `gestureRoot` around the rows.
  The demo has one.
- The JavaScript driver commits once per finger movement and once per
  frame while a spring runs.
- The row's width comes from its layout event. Until that arrives, 360
  points is assumed.
