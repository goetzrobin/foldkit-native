# Track: navigation

Everything beyond the basic stack that already works.

## What exists

Working on a real iPhone: `packages/native/src/navigation.ts` (`stack`,
`screen`, `header`, `title`, `safeArea`, `onDismissed`,
`registerNavigation`) and `screenModule` in `packages/native/src/modules.ts`.
It drives react-native-screens' native views (`RNSScreenStack`, `RNSScreen`,
`RNSScreenStackHeaderConfig`, `RNSSafeAreaView`) directly, with none of
react-native-screens' JavaScript. The Model holds the list of open screens. A
native pop (swipe-back) reports `topDismissed` and the Model catches up. See
`packages/native/test/notes.ts` and `notes.test.ts`.

## Reference

ng-native's router package: `/home/claude/repos/ngn/src/packages/router/src`.
Read `screens.ts` (view names, registration, and its long comments),
`native-stack-outlet.ts`, `native-header.ts`, `native-back.ts`,
`screen-presentation.ts`, and whatever implements tabs and modals (search for
`RNSBottomTabs`, `RNSTabs`, `stackPresentation`, `modal`, `formSheet`,
`headerBackButtonClicked`, `HardwareBackPress`). Those files are Angular
components. Port the native facts (view names, props, events, ordering
rules), not the Angular.

Remember lesson 2 in the brief: a rule lifted out of its component can be
wrong here. Read the surrounding code, and list in your report each rule you
ported without being able to verify it.

## Ownership

You OWN `packages/native/src/navigation.ts` for this task. You may
restructure it into `packages/native/src/navigation/`. Keep every existing
export working, since `test/notes.ts` and `apps/notes` use them (re-export
from `src/navigation.ts` if you move things). Put per-element behaviour in
your own module factories registered with `registerModule`. Do not edit
`modules.ts`: `screenModule` there stays as is and already handles tag
`screen`.

## Deliver

1. **Tabs.** A native bottom tab bar with at least three tabs, each holding
   its own stack. The Model holds the selected tab and each tab's stack.
   Selecting a tab natively sends a Message so the Model catches up, and the
   Model selecting a tab changes the native selection. Tab title, and an icon
   if react-native-screens supports SF Symbols or system items without extra
   packages (say what you chose and why).
2. **Modal and sheet presentation.** Present a screen as a modal and as a
   form sheet (`stackPresentation`), dismissed by button (Model) or by
   swipe-down (native, with the Model catching up through `onDismissed`).
3. **Title bar.** A right-side button in the header that sends a Message,
   large title on and off, hiding the header, a back button title, and
   preventing native back when the Model says so (unsaved changes, for
   example) if react-native-screens supports it without React.
4. **Android back button.** Hardware back pops the top screen through the
   Model, or exits when at the root. Find how ng-native listens
   (`native-back.ts`) and port it with the React Native event source injected
   and not imported (`packages/native` must not import `react-native`).
5. **A small routing helper** so a program does not hand-write the stack
   plumbing: a typed `Route` union plus helpers `push`, `pop`, `popTo`,
   `replace`, `popByPhone(count)` over an array in the Model, and a view
   helper that maps the array to keyed `screen`s. Keep it tiny and idiomatic
   for Foldkit.
6. `packages/native/test/demos/navigation.ts` (demo program, contract in the
   brief). Three tabs. Tab one: a stack you can push several levels deep,
   with a visible depth number and the route list printed on screen, so a
   person can see the Model agree with what is shown after swiping back. Tab
   two: modal and sheet buttons. Tab three: header options (toggle large
   title, a header button that increments a counter, a toggle "block back"
   that makes back ask first or be refused). An Exit control calling
   `env.exit`, reachable from the first tab.
7. `packages/native/test/navigation.test.ts` on the simulated phone: native
   tab change to Model, Model tab change to native prop, push, pop, popTo,
   replace, native dismiss of N screens, modal present and both dismiss
   paths, header button press to Message, hardware back at depth and at root
   (with a faked back source).
8. Prove it builds. Copy `apps/notes` to a new app `apps/navigation/` (keep
   its `vendor/`), run `scripts/sync-apps.sh`, make its entry embed your demo
   (pass `{ device, exit: () => {} }`), then `npm install`,
   `npx tsc --noEmit`, and
   `CI=1 npx expo export --platform ios --platform android --output-dir /tmp/fkn-navigation`.

## Constraints

Besides `src/navigation.ts` (yours), do not edit core files or other apps. Do
not modify the Foldkit fork. Do not add npm dependencies to
`packages/native`. `react-native-screens ~4.30.0` is already in the app. If
tabs need a different native package than react-native-screens, do not add
it. Say so and build the best version available with what Expo Go ships.
