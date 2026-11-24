# Streaming Markdown

This is how the app draws an AI reply as rich text while it streams in:
headings, bold and italic, lists, tables, code with colours, quotes, links
and pictures. The first part is for the project owner. The last part lists
every native name the code relies on, for an engineer chasing a build error.

## You need the prebuilt app

The reply is drawn by **react-native-enriched-markdown**, a library from
Software Mansion. It turns Markdown into the phone's own text views, in
native code. Expo Go does not contain it, so it only works in an app you
build yourself.

To build it after pulling these changes (in `apps/showcase`):

```
npm install
npx expo prebuild --clean
npx expo run:ios
```

`npm install` also downloads two things the library needs: the code
colouring rules (tree-sitter) and the maths renderer (RaTeX). It needs the
internet for that. `prebuild --clean` throws away the old `ios` and
`android` folders and makes them again with the new native code. For
Android, the last line is `npx expo run:android`. `docs/DEV_BUILD.md` has
the one-time Mac setup.

In Expo Go the demo still opens. It draws a plain fallback and the line at
the top says why.

## What you see

Open **Streaming markdown** from the menu. The line at the top says which
renderer is drawing:

| The line says | What it means |
|---|---|
| Renderer: native (react-native-enriched-markdown) | The real thing. |
| Renderer: Foldkit fallback, because ... not in this build (Expo Go) ... | You are in Expo Go, or the app was not rebuilt after `npm install`. |
| Renderer: Foldkit fallback (chosen) | You pressed the "Foldkit fallback" chip. |

Press **Stream it** and a sample reply is played back piece by piece, the
way a language model sends it. It uses every kind of Markdown once. **Long
reply** plays about 3,000 words.

## How it behaves

- **New words fade in** over a fifth of a second. The native view does
  this itself. It skips the fade when the phone is set to reduce motion.
  The **Fade** chip turns it off.
- **Old text never fades again.** Close a chat and open it later: the
  reply is just there. **Close and reopen** in the demo shows this.
- **Half-written Markdown looks right.** While a reply streams, `**bold`
  without its closing stars is drawn bold, and a link whose address has not
  arrived shows its words only. A small library called **remend** (from
  Vercel) does this before the text is drawn. A picture appears once its
  address is complete.
- **Tables grow row by row, code blocks line by line.** Code gets its
  colours as it arrives. Wide tables and long code lines scroll sideways.
- **Tap a link** and the browser opens. Long press a link on an iPhone for
  a preview of the page.
- **Copy** on a code block puts the code on the clipboard. The demo then
  says how many lines it copied.
- **Long press any text** to select it. The menu offers Copy and Copy as
  Markdown. While a reply is still streaming, text cannot be selected.
- **Light and dark** follow the phone.

## The numbers

Press **Show numbers** in the demo. Measured here on a laptop, not on a
phone:

| What | Number |
|---|---|
| Long reply | 3,233 words, 16,934 characters, 3,699 tokens |
| remend per run, whole long reply | 0.16 ms average, 0.19 ms near the end (normal speed) |
| remend per run, with the JavaScript compiler switched off (closer to a phone) | 0.62 ms average, 1.3 ms near the end |
| remend runs | one per screen frame at most, not one per token |
| Text sent to the native view | at most one update per frame: the whole reply each time, up to 17 KB at the end |

Why send at most once a frame: tokens can come faster than the screen
draws, and every update makes the native code read the whole reply again.
The newest text always wins, so nothing is lost. In the "burst" speed the
demo sends 40 tokens at a time and the native view still gets one update
per frame.

The native view's own work (reading the Markdown, drawing, fading) happens
in native code on a background thread. JavaScript cannot time it. On the
phone, watch for stutter while the long reply streams: that is the real
test.

## The fallback

Where the native view is missing, the reply is drawn with plain Foldkit
views: paragraphs, bold headings, and code blocks that scroll sideways with
a Copy button. Markdown marks are taken out and the words kept. Tables,
lists and pictures are not drawn as such. It exists so the screen does not
crash or go blank, not to look good.

While a reply streams, the fallback draws only its last block again.

## For an engineer: every native name used

Nothing native was compiled here. If the build or the screen fails, these
are the names the code relies on, with the file each was read from (in
`node_modules/react-native-enriched-markdown`, version 1.2.0, unless it
says otherwise).

| What | Value | Read from |
|---|---|---|
| Native view name | `EnrichedMarkdown` (GitHub flavour) | `src/EnrichedMarkdownNativeComponent.ts` (`codegenNativeComponent('EnrichedMarkdown')`), `android/.../EnrichedMarkdownManager.kt` (`NAME`), `android/src/main/jni/.../MarkdownContainerShadowNode.cpp` |
| iOS class | `EnrichedMarkdown` | `package.json` `codegenConfig.ios.components`, `ios/EnrichedMarkdown.mm` |
| Presence check | `globalThis.__nativeComponentRegistry__hasComponent('EnrichedMarkdown')` | React Native 0.88: `React/Fabric/Mounting/RCTComponentViewFactory.mm`, `ReactAndroid/.../ComponentNameResolverBinding.cpp` |
| `markdown` | the text, after remend | `src/EnrichedMarkdownNativeComponent.ts`, `updateProps` in `ios/EnrichedMarkdown.mm` |
| `markdownStyle` | every block of `MarkdownStyleInternal`, colours as processed numbers | same spec file; defaults copied from `src/normalizeMarkdownStyle.ts` |
| `isGFM` | `true`: tables, task lists, strikethrough | spec file; `src/native/EnrichedMarkdownText.tsx` |
| `md4cFlags` | the wrapper's defaults | `src/native/EnrichedMarkdownText.tsx` (`defaultMd4cFlags`) |
| `streamingAnimation` | off for the first draw, then on while streaming | `ios/EnrichedMarkdown.mm` (`ENRMTailFadeInAnimator`, 0.2 s), `android/.../EnrichedMarkdown.kt` (`BLOCK_FADE_DURATION_MS` 200) |
| `streamingConfig` | `progressive` for tables, code and media | spec file (`StreamingConfigInternal`), wrapper defaults |
| `selectable` | `false` while streaming | as `react-native-streamdown` 0.3.0 does (`src/StreamdownText.tsx`) |
| `selectionColor` | the theme's | spec file |
| `selectionMenuConfig`, `accessibilityLabels`, `linkRecognition` | the wrapper's defaults | `src/native/EnrichedMarkdownText.tsx`, `src/accessibilityLabelDefaults.ts`, `src/utils/regexParser.ts` |
| Other props | `allowFontScaling`, `allowTrailingMargin`, `enableLinkPreview`, `enableBlockContextMenu`, `enableTaskListItemToggle` (off), `enableCodeBlockWrapToggle`, `enableImagePress`, `enableTextPress`, `enableCodeBlockPress`, `writingDirection`, `spoilerOverlay`, `textBreakStrategy`, `lineBreakStrategyIOS` | spec file |
| Events | `topLinkPress` `{ url }`, `topCopyPress` `{ code, language }` | spec file; `android/.../events/LinkPressEvent.kt`, `CopyPressEvent.kt` (sent as `onLinkPress`, React Native turns it into `topLinkPress`) |
| Size | no event: the view measures itself | `MarkdownContainerShadowNode.h` (`measureContent`) |
| Copy button | native code copies, then sends `topCopyPress` | `ios/segments/ENRMCodeBlockContainerView.m` (`copyCodeToPasteboard`), `CodeBlockContainerView.kt` |
| Build options | `"enriched-markdown"` block in `apps/showcase/package.json`: code colours on, maths on, video off | `README.md`, `ReactNativeEnrichedMarkdown.podspec` |
| remend options | streamdown's: `linkMode: 'text-only'`, `katex: false`, the rest on | `react-native-streamdown` 0.3.0 `src/worklets/remendWorklet.ts` |

No Expo config plugin is needed: version 1.2.0 has none, and React Native's
autolinking finds the native code. The New Architecture is required and is
the only one Expo SDK 58 has.

The code: `packages/native/src/markdown/` (`markdown.ts` is the entry,
`native.ts` drives the native view, `nativeStyle.ts` builds its props,
`theme.ts` is the look, `fallback.ts` the plain renderer). The app hands
remend over in `apps/showcase/index.ts` with `configureMarkdown({ remend })`.
