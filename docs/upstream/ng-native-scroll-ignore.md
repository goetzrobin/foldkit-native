## What changed and why

On iOS, a press on something inside a `scroll-view` was canceled whenever the list scrolled, including when the app scrolled it and the finger never moved. This change leaves the press alone for a scroll the app made.

**How it shows up.** A chat screen that follows a reply as it streams in calls `scrollToEnd` several times a second. A finger resting on a message through that never gets `longPress`, so its context menu cannot open while a reply is streaming, and a plain tap on a row is lost too. The same happens under any scroll no finger asked for: `scrollTo`, a content inset that changes with the keyboard, content that grows under `maintainVisibleContentPosition`.

**Why it happens.** `cancelPressForScroll` releases the responder on every `topScroll` inside which it sits. Its comment says programmatic scrolling "has no press to cancel", but a finger can be down while the app scrolls.

**What React Native does.** iOS says on the event who scrolled. `RCTScrollViewComponentView.mm` sets `responderIgnoreScroll` from `!_isUserTriggeredScrolling`, which a drag turns on and the end of its momentum turns off. React Native's responder then leaves a marked scroll out of a transfer (`canTriggerTransfer` in `ReactNativeResponder.js`: `topLevelType === 'topScroll' && nativeEvent.responderIgnoreScroll !== true`).

**The change.** A new `isAppScroll` in `engine.ts`, read at the top of `cancelPressForScroll`: on Apple's platforms a `topScroll` with `responderIgnoreScroll: true` does not cancel the press. Everything else is as before:

- A scroll the finger makes, and its momentum, still cancel (the mark is `false` for both).
- `topScrollBeginDrag` still cancels, whatever it carries. A drag that begins is the finger's.
- **Android is unchanged on purpose.** `ScrollEvent.kt` sets `responderIgnoreScroll` on every scroll, the finger's too, from `!ReactNativeFeatureFlags.shouldTriggerResponderTransferOnScrollAndroid()`, and that flag is off. Reading the mark there would stop a real scroll from canceling a press, which is the bug `scroll-press.test.ts` was written for. So Android still cancels a press under an app-made scroll. Fixing that needs another signal (for example, whether a drag is in progress on that scroll view), and I left it out to keep this small. Happy to follow up if you want it.
- macOS takes the same branch through `isApplePlatform()`, but I found nothing in the desktop host that sets the field, so nothing changes there. Say if you would rather this were `'ios'` only.
- The web host's `notifyScroll` (`packages/web/src/responder.ts`) is not touched. A DOM scroll event does not say who scrolled.

## How this was tested

Test first, in `packages/integration-tests/scroll-press.test.ts`. Four new cases:

| Case | Without the change | Guards |
|---|---|---|
| fires when the app scrolled the list under a finger that stayed put | fails | the fix |
| does not fire when the finger scrolls a list the app is scrolling too | passes | a finger's scroll between two app scrolls still cancels |
| does not fire when a drag begins, whatever the scroll events after it say | passes | fails if the `topScroll` check is removed from `isAppScroll` |
| on Android: does not fire when the list scrolled under the finger, though the scroll is marked | passes | fails if the `isApplePlatform()` check is removed |

I removed each half of the condition in turn and watched the matching guard go red.

- `scroll-press`, `press-tolerance` and `click-press`: 23 of 23 pass.
- `pnpm nx run-many -t lint typecheck -p @ng-native/fabric @ng-native/integration-tests`: green.
- `pnpm nx run @ng-native/integration-tests:test`: 10,831 tests, 10,827 pass, 3 skipped, 1 fails. The one failure is `device-testing-linux.test.ts` ("the Linux launcher"), which fails the same way on `main` without this change in my environment (a Linux container with no display).
- `prettier --check` on the three files: clean.

**Not tested:** on a device or simulator. I have no Mac here. Where I met this was an app that drives `@ng-native/fabric` 0.25.0 directly on an iPhone: a hold on a list row never fired while the list followed a streaming reply. The device confirmed the bug; the fix has only run on the fake Fabric. The `responderIgnoreScroll` values above are read from React Native 0.88.1's source, not observed on a device.

## Checklist

- [x] Tests added or updated
- [ ] Docs updated: none needed that I could find. `pressable.md` describes `cancelable` and the responder in general terms and does not say which scrolls cancel a press. Glad to add a sentence if you want one.
- [x] A version plan in `.nx/version-plans/` (`press-through-app-scroll.md`, patch)
- [ ] `pnpm lint typecheck test` is green locally: lint and typecheck were run for `fabric` and `integration-tests` only, and tests for `integration-tests` only (see above), not the whole workspace
- [x] Respects the rules in ARCHITECTURE.md: the engine reads a field of the native event and imports nothing new

🤖 Generated with [Claude Code](https://claude.com/claude-code)
