# ng-native: a scroll the app made cancels a press

Patch: `ng-native-scroll-ignore.patch` (against ng-native `main` at 0069c28).
Apply in an ng-native checkout with `git am ng-native-scroll-ignore.patch`.

## What goes wrong

Hold a row in a list while the list scrolls by itself (a chat following a
streamed reply, a `scrollTo`, a changed `contentInset`). The press or long
press is cancelled within a frame, though the finger never moved.

## Why

React Native's scroll view marks every scroll no finger caused:
`RCTScrollViewComponentView.mm` sets
`metrics.responderIgnoreScroll = !_isUserTriggeredScrolling`.
React's responder system skips those (`ReactFabric-prod.js`:
`"topScroll" === topLevelType && !nativeEvent.responderIgnoreScroll`).

ng-native's engine does not read the mark. `cancelPressForScroll` in
`packages/fabric/src/engine.ts` releases the responder on every `topScroll`
inside the list. Its own comment assumes programmatic scrolling happens with
no touch in progress, which is not true for a list that follows content.

## The fix

Skip `topScroll` events marked `responderIgnoreScroll`. `topScrollBeginDrag`
always comes from a finger and still cancels. 11 lines in the engine.

## Tests

Two cases added to `packages/integration-tests/scroll-press.test.ts`:

- a press survives two scrolls marked `responderIgnoreScroll: true`
- a press is still cancelled when a finger scroll follows an app scroll

Not run in ng-native's own suite (it needs the full Angular workspace
installed). Checked instead in Foldkit Native's suite, which runs ng-native's
engine from source: a pressable row inside a scroll view, a `topScroll` with
`responderIgnoreScroll: true` between touch start and end. Without the patch
the press is lost (count 0); with it the press counts (1). A scroll without
the mark still cancels the press in both.

Found on an iPhone (iOS 27, React Native 0.88.1) in Fold Chat, where holding a
streaming reply never opened its menu.

---

## Suggested pull request text

**fix(fabric): a scroll the app made does not cancel a press**

A press or long press inside a list is cancelled when the list scrolls by
itself under a resting finger: a chat following streamed content, a
`scrollTo`, or a `contentInset` change. RN marks those scrolls
`responderIgnoreScroll` (`RCTScrollViewComponentView.mm`,
`!_isUserTriggeredScrolling`) and React's responder system ignores them for
press cancellation. The engine's `cancelPressForScroll` did not check the
flag. This skips `topScroll` events with `responderIgnoreScroll: true`;
`topScrollBeginDrag` still cancels. Two cases added to
`scroll-press.test.ts`.
