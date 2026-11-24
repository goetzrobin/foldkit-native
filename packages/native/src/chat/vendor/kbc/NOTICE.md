# react-native-keyboard-controller, vendored

The files in this folder come from **react-native-keyboard-controller**
version 1.22.7 (commit `02a5ea4`,
https://github.com/kirillzyusko/react-native-keyboard-controller), copyright
Kiryl Ziusko, under the MIT licence in `LICENSE` beside this file.

They are the arithmetic of its `KeyboardChatScrollView`: how much bottom
inset a chat's scroll view gets for the keyboard, and where it should scroll
to, once, as the keyboard starts to move. None of the library's React
components, hooks or native code is here. The app needs the library's native
half in the build for the keyboard's own reports (see `../../keyboard`).

| File | From | Changed |
|---|---|---|
| `helpers.ts` | `src/components/KeyboardChatScrollView/useChatKeyboard/helpers.ts` | The import of `interpolate` from Reanimated is replaced by five lines that draw the same straight line. Nothing else. |
| `types.ts` | `.../useChatKeyboard/types.ts` | Cut down to `KeyboardLiftBehavior`. |
| `chatKeyboard.ts` | `.../useChatKeyboard/index.ios.ts`, `.../useExtraContentPadding/index.ts`, `.../KeyboardChatScrollView/index.tsx` | Rewritten from React hooks into one plain object. The handler bodies and their comments are the library's. |

The library's own test cases for these files are ported in
`test/kbcHelpers.test.ts` and `test/kbcChatKeyboard.test.ts`, so the numbers
here are checked against the numbers the library expects, case by case.

The Android strategy (`useChatKeyboard/index.ts`, which scrolls on every
frame of the keyboard's movement) is not ported. See `../chatScroll.ts`.
