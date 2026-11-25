# Fold Chat

An AI chat app built with Foldkit Native. Every screen is the phone's own
views, drawn by a Foldkit program. React draws nothing.

The replies come from a pretend AI server that runs inside the app. It
knows a handful of answers and writes them out a few words at a time, the
way a real model does. Some replies think first, some look up the weather
or your notes first. Nothing goes over the internet.

Nobody has run this app on a phone yet. It was built and tested on a
laptop, where a simulated phone can check what the app asks for but cannot
show how it looks or feels. That is what your first build is for.

## Build it on your iPhone

You need the Mac setup from `docs/DEV_BUILD.md` (Xcode, your Apple ID in
Xcode, the iPhone trusted and in Developer Mode). If the showcase app built
for you, you have it all.

Connect the iPhone with a cable. In Terminal, from the project folder:

```
cd apps/chat
npm install
npx expo prebuild --clean
npx expo run:ios --device 2>&1 | tee build-ios.log
```

- `npm install` fetches the app's packages. It also downloads two things
  the reply renderer needs, so it needs the internet.
- `npx expo prebuild --clean` makes the `ios` and `android` folders fresh.
- `npx expo run:ios --device` builds the app and puts it on the phone. Pick
  your iPhone when it asks. The first build takes 10 to 30 minutes.
- `2>&1 | tee build-ios.log` keeps a copy of what the build prints, in case
  it fails.

The app is called **Fold Chat** on the home screen. If the phone says the
developer is not trusted: Settings, General, VPN & Device Management, your
Apple ID, Trust.

If the build stops and says the bundle identifier is taken, open `app.json`,
change `dev.foldkitnative.chat` in both places to something of your own,
such as `com.yourname.foldchat`, and run the last two commands again.

For Android, start the emulator and run `npx expo run:android 2>&1 | tee build-android.log`.

Changing the app's TypeScript needs no new build: the app reloads from the
Mac while `npx expo run:ios --device` is running.

## What to try first

1. Tap the pencil at the top right. A new chat opens with the keyboard up.
   Type "How do I start running?" and tap the blue arrow.
2. Watch your question rise to near the top of the screen. "Thinking"
   shimmers for a moment, then the answer is written under your question.
3. In a new chat, tap the suggestion "Train or car?". The model thinks
   first. Tap "Thought for 4 s" to read its reasoning in a sheet.
4. Ask "What is the weather in Lisbon tomorrow?" and watch the quiet
   "Checking the weather" line with its small spinner.
5. Press and hold an answer. Try Copy, Select text and Share. Swipe back to
   the list, swipe a chat to the left, and try Rename and Delete.

The gear at the top left opens Settings: light and dark, and the demo
controls that make the pretend server slow or broken on purpose.

## What to look at

Answer yes or no. Any no, take a screenshot, and if it is about where
something sits, turn on "Show list and keyboard numbers" in Settings (or
press and hold the chat's title) before you take it.

1. Does the app open to "Chats" with a large title and a search field under it?
2. After Send, does your question move to near the top in one smooth move?
3. While the answer is written, does your question stay perfectly still?
4. Do new words fade in softly, with no stray stars or brackets?
5. Before the first word, does "Thinking" show a soft band of light sweeping across it?
6. Does the composer look like glass, with the chat visible through it when you scroll?
7. When you tap the text field, does the composer ride up with the keyboard, stuck to it?
8. With the keyboard up, if you drag the messages down, does the keyboard follow your finger?
9. Does the composer grow as you type a few lines, and stop growing after about five?
10. While an answer is written, is there a round Stop button, and does it stop the answer?
11. When an answer runs off the bottom, does a round arrow button appear above the composer?
12. Does swiping a chat left show Delete and Rename, and does a long swipe delete it?
13. Does pressing and holding a chat in the list open the phone's own menu?
14. Settings, Theme, Dark: does everything turn dark at once, the bar and keyboard included?
15. Do you feel a light tap on Send and a softer tick when the first words arrive?
16. While an answer is being written, press and hold it. Do you feel a firm
    tap after half a second, and does a menu with "Copy so far" and "Stop"
    open? With the numbers on, the last line starts "hold: native recogniser
    on" and then says "last: recognised by native after ... ms". If you feel
    no tap, or the menu does not open, screenshot that line: it says which
    way the hold was read, or why it was cancelled.

## If the build fails

Only the first error matters. To find it:

```
grep -n "error:" build-ios.log | head -20
```

For Android:

```
grep -E -n -A3 "^e: |FAILED|What went wrong" build-android.log | head -40
```

Send back what that prints.

| What you see | What to send or do |
|---|---|
| `Signing for "FoldChat" requires a development team` | Open `apps/chat/ios/FoldChat.xcworkspace` in Xcode, click the project, Signing & Capabilities, choose your team. Run the last command again. |
| `bundle identifier ... is not available` | See above: change it in `app.json`. |
| A failure during `pod install` | Send the last 30 lines of `build-ios.log`. |
| Errors naming `EnrichedMarkdown` or `tree-sitter` | Run `npm install` again with the internet on, then the last two commands. |
| The app opens and closes at once | Settings, Privacy & Security, Analytics & Improvements, Analytics Data, the newest file starting `FoldChat`. Send it. |
| The app opens but a screen is blank or wrong | A screenshot, with the numbers on if it is the chat. |

## Choices made, in short

- **The chat list** is this project's own list, not the Legend List port.
  It is the one that knows the keyboard's "inset" way (the messages keep
  their height and scroll clear of the keyboard), keeps room under your
  question so it can sit at the top, and can show its numbers.
- **List to chat** is the phone's own screen stack: a push, and swipe from
  the left edge to go back. It is what iPhone apps do and what has already
  worked on your phone in Notes. A pager like Margelo's app would need a
  native view this project does not have yet.
- **Swipe on a chat** uses the swipe row written in TypeScript, moved on the
  UI thread. The native swipe view from the showcase is left out until your
  showcase build shows that its Swift compiles: a compile error there would
  stop this app from building at all. To add it later, copy
  `apps/showcase/modules/foldkit-swipe` to `apps/chat/modules/` and run
  `npx expo prebuild --clean`. The app finds it by itself and uses it.
- **Holding a message** opens the phone's action sheet. Holding a chat in
  the list opens the phone's own menu with a lifted preview.
