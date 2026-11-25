# Fold Chat: design spec

One page, written before the code. The app is a neutral AI chat. It should
look quiet: black, white and greys, one accent colour, careful type, and
quick motion that means something. No purple, no sparkles, no gradients.

## Screens

1. **Chats** (home). Native large title "Chats". Search field under the
   title (the phone's own on iPhone; a plain field at the top of the list on
   Android). Left bar button: settings (gear). Right bar button: new chat
   (pencil on square). Conversations grouped under "Today", "Yesterday",
   "Previous 7 days", "Previous 30 days", then month names. Each row: title
   (one line) and a preview (one line). Swipe left: Delete (full swipe
   deletes) and Rename. Press and hold: Rename, Delete. Tap: open the chat.
2. **Chat**. Pushed on the native stack, swipe back to leave. Title is the
   conversation's title. Right bar button: a menu (Rename, Delete, Settings).
   The transcript fills the screen and runs under the composer. Your
   question goes near the top of the screen after Send; the reply streams in
   under it. A round "scroll to end" button appears when the end of the
   transcript has gone under the composer's top edge; it sits 8 above that
   edge and moves with the composer. The composer floats at the bottom on
   glass, 8 above the keyboard when the keyboard is up.
3. **Settings** (sheet, half and full height). Theme: System, Light, Dark.
   Demo controls, labelled as such: reply speed (slow, normal, fast) and four
   failure switches. About Foldkit Native. A "Show numbers" switch.
4. **Reasoning** (sheet, half and full height). "Thought for 4 s" as title,
   the reasoning as plain text.
5. **Rename** (sheet that fits its content). One text field, Cancel, Save.

## Type scale (points)

| Role | Size / line | Weight | Colour |
|---|---|---|---|
| Large title | the phone's | | ink |
| Bar title | the phone's | | ink |
| Reply body (Markdown) | 16 / 24 | 400 | ink |
| Your message | 16 / 22 | 400 | ink |
| Row title | 16 / 21 | 500 | ink |
| Row preview | 14 / 19 | 400 | ink 2 |
| Section header | 13 / 18 | 600 | ink 3 |
| Meta row (Thought for, tool) | 14 / 20 | 500 | ink 2 |
| Caption (Stopped, errors) | 13 / 18 | 400 | ink 3, danger for errors |
| Empty state headline | 22 / 28 | 600 | ink |

## Spacing scale

4, 8, 12, 16, 20, 24, 32, 48. Screen edges 16 on the list, 20 in the
transcript. 24 between one exchange and the next, 12 between your message
and its reply. Composer: 8 around the field, 12 from the screen edges.

## Colour tokens

| Token | Light | Dark | Used for |
|---|---|---|---|
| bg | #FFFFFF | #0B0B0C | screens |
| surface | #F2F2F3 | #1C1C1E | your message, search field, chips |
| surface 2 | #E8E8EA | #2A2A2D | pressed rows, code blocks |
| line | #E3E3E6 | #2C2C30 | hairlines |
| ink | #0D0D0E | #F4F4F5 | text, icons |
| ink 2 | #5C5C63 | #A1A1A8 | previews, meta rows |
| ink 3 | #9A9AA1 | #6E6E75 | section headers, placeholders |
| accent | #0B6BCB | #4DA3FF | Send, links, switches, selection |
| on accent | #FFFFFF | #0B0B0C | the arrow on Send |
| danger | #C4352B | #FF6B5E | Delete, errors |
| glass fallback | rgba(242,242,243,0.92) | rgba(28,28,30,0.92) | composer where Liquid Glass is missing |

The accent is the only colour. It appears on Send, links, switches and the
text cursor, and nowhere else.

## Corner radii

Your message 20. Composer field 22 (a pill at one line). Round buttons
(Send, Stop, mic, scroll to end) are circles. Chips 12. Code blocks and
tables 12. Pressed row highlight 12.

## Motion

| What | How long | Curve |
|---|---|---|
| Your new message appears | 380 ms, rises 24 points and fades in | fast then gentle (0.16, 1, 0.3, 1) |
| Question moves to the top | the list's own scroll | native |
| "Thinking" appears | fades in over 200 ms after 300 ms, once your message has risen | ease out |
| Reply words fade in | 200 ms | native (Markdown view) |
| Thinking shimmer | one sweep every 1.4 s | linear |
| Send turns into Stop | 120 ms cross fade | ease out |
| Scroll to end button | 150 ms fade, growing from 80% | ease out |
| Press on a row or button | instant dim to 60% | none |
| Screens, sheets, menus | the phone's own | native |

Nothing bounces that the phone does not bounce itself. With Reduce Motion
on, the Markdown view skips its fade by itself.

## Haptics map

| Event | Haptic |
|---|---|
| Send | light impact |
| First word of a reply | selection tick |
| Stop | medium impact |
| Regenerate | light impact |
| Copy | success |
| Delete | warning |
| Full swipe reaches the delete line | light impact |
| Theme changed | selection tick |
| Recording starts / stops | medium / light impact |
| A reply fails | error |

## States

- **Empty list.** Centred: "No chats yet" (headline), "Start one and it
  shows up here." (ink 2), a "New chat" button in ink.
- **Empty chat.** Centred: "Ask anything" and three suggestion chips that
  send a question when tapped.
- **Loading.** A small grey spinner in the middle. No skeletons.
- **Thinking.** Before the first word: the word "Thinking" with a slow
  light sweep across it, drawn with Skia. Plain grey text where Skia is
  missing.
- **Finished.** Under each reply, three small grey icons: Copy, Share and,
  under the newest, Regenerate. Holding a message opens Copy, Select text,
  Share and Regenerate in the phone's action sheet.
- **Streaming.** Words fade in. The Send button is a Stop button (a filled
  square in a circle). Reasoning shows as "Thought for 4 s ›"; a tool call
  as a quiet row with a small spinner, then "Checked the weather".
- **Stopped.** The partial reply stays. Under it: "Stopped" in ink 3.
- **Error.** Under the partial reply: the reason in danger red, and a "Try
  again" text button. A message the server refused comes off the screen,
  goes back into the composer, and a line above the composer says why.
- **Offline.** A slim line under the bar: "You are offline. Sending is off
  until you are back." The Send button is greyed.
- **Connection lost mid reply.** Retries by itself (0.25, 0.5, 1, 2, 4 s).
  After four tries in a row, a "Reconnect" text button under the reply.
