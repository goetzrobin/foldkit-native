# Effect Chat

Fold Chat, built again on Effect UI. It draws with the phone's own views and
React draws nothing. All three steps are done.

- Step 1: the list of chats, opening a chat, reading it, and sending a
  message that gets a streamed reply.
- Step 2: how the chat screen moves. The composer (the text field and its
  round button) moves with the keyboard. Your question goes to the top after
  Send. The list can follow a reply as it is written. A round button takes
  you to the end.
- Step 3: what you reach by holding or from a menu. Hold a message to copy
  or share it. Settings, light and dark. Delete and rename a chat. Search.
  Voice notes. And one thing Fold Chat does not have: a microphone button
  that writes what you say into the text field.

The replies come from a pretend AI inside the app. It knows a few topics and
writes its answers a few letters at a time, as a real one does. No network
is needed.

Nobody has run this app on a phone yet. It was built and tested on a laptop,
where a simulated phone can check what the app asks for but cannot show how
it looks or feels.

## Build it on your iPhone

**Step 3 needs a new build.** It adds a native package (speech recognition),
and native code only gets onto the phone with a build. If you built this app
before step 3, reloading it is not enough: run all four commands below
again, `npx expo prebuild --clean` included. The phone will ask two new
questions the first time you use the microphone button: one for the
microphone and one for speech recognition.

If you skip the rebuild, the app still opens and everything else works. The
microphone button then shows a line that says the build has no speech
recognition.

You need the Mac setup from `docs/DEV_BUILD.md` (Xcode, your Apple ID in
Xcode, the iPhone trusted and in Developer Mode). If Fold Chat built for
you, you have it all.

Connect the iPhone with a cable. In Terminal, from the project folder:

```
cd apps/eui-chat
npm install
npx expo prebuild --clean
npx expo run:ios --device 2>&1 | tee build-ios.log
```

- `npm install` fetches the app's packages. Effect UI is not in the public
  package store yet, so it comes from a file in this project
  (`packages/effect-ui-native/vendor`).
- `npx expo prebuild --clean` makes the `ios` and `android` folders fresh.
- `npx expo run:ios --device` builds the app and puts it on the phone. Pick
  your iPhone when it asks. The first build takes 10 to 30 minutes.
- `2>&1 | tee build-ios.log` keeps a copy of what the build prints, in case
  it fails.

The app is called **Effect Chat** on the home screen. If the phone says the
developer is not trusted: Settings, General, VPN & Device Management, your
Apple ID, Trust.

If the build says the bundle identifier is taken, open `app.json`, change
`dev.foldkitnative.euichat` in both places to something of your own, and run
the last two commands again.

Changing the app's TypeScript needs no new build: the app reloads from the
Mac while `npx expo run:ios --device` is running.

## Twelve checks for step 1

Answer yes or no.

1. **First screen.** Does a screen titled "Chats" appear by itself, with
   "No chats yet" and a "New chat" button in the middle?
2. **New chat.** Tap "New chat". Does a new screen slide in, titled "New
   chat", with "Ask anything" and three questions? (The keyboard comes up
   too. That is checked in step 2.)
3. **A question from the list.** Tap "How do I start running?". Does your
   question appear at once, on the right, on a grey shape?
4. **The reply streams.** Does the word "Thinking" show for a moment, and
   then the reply grow a few words at a time until it is whole?
5. **Rich text.** Does the finished reply have a heading, bold words and a
   table, not stars and pipes?
6. **Typing.** Tap the field at the bottom. Does the keyboard come up with
   the field still in view above it? Type "weather in Paris" and tap the
   round button. Does the field empty and your message appear?
7. **A second reply.** Does the second reply stream in under your message?
8. **Swipe back.** Swipe from the left edge. Does the chat slide away with
   your finger and the list come back?
9. **The list is up to date.** Does the list now show one chat, with a
   title made from your first question and, under it, the start of the
   last reply? You did nothing to refresh it.
10. **The bar button.** Tap the button at the top right of the list. Does a
    new, empty chat open? Go back: are there two chats in the list?
11. **Opening a saved chat.** Tap the first chat you made. Do both
    questions and both replies show, in order?
12. **Still there tomorrow.** Close the app from the app switcher and open
    it again. Are your chats still in the list?

## The numbers strip

The app can show its own numbers, so you can read them out. In a chat, hold
a finger on the title at the top of the screen for half a second. A thin
dark strip appears over the top of the messages. Hold the title again to
turn it off. It stays on when you open another chat.

It looks like this:

```
offset 1216 of 1216, at end, following
inset 102, blank 0, bar covers 102, gap 34, keyboard 0
question y 16.0, drift +0.0
holds 0, last held none, keyboard moved by the phone
hold: native recogniser on, JS as backup | last: none yet
```

| Words | What they mean |
|---|---|
| `offset 1216 of 1216` | How far the list is scrolled, and the furthest it can go. Equal numbers: you are at the end |
| `at end` / `not at end` | Whether the last message is in view above the composer |
| `following` / `not following` | Whether the list moves by itself as a reply grows |
| `inset 102` | How much room the list keeps free at its bottom |
| `blank 0` | Empty room kept under a new reply. It shrinks as the reply grows |
| `bar covers 102` | How much of the screen's bottom the composer covers, with the keyboard if it is up |
| `gap 34` | The space between the composer and the keyboard. 34 with the keyboard down, 0 with it up |
| `keyboard 0` | The keyboard's height. 0 when it is down |
| `question y 16.0` | Where your last question is, counted from the top of the list. Shown after you send |
| `drift +0.0` | How far that question has moved since it was put there. It should stay at 0 |
| `holds 0` | How many times a finger was held on a message in this chat |
| `keyboard moved by the phone` | The phone moves the composer. `keyboard padded` means the app does, which is the Android way |
| `hold: native recogniser on, JS as backup` | The phone itself reads a finger held on a message, and the app's own timer stands by. `JS route (native off: ...)` means only the timer does, and says why |
| `last: recognised by native after 512 ms` | How the last hold went, and which of the two read it |

All numbers are in points. Your numbers will differ from the example. Only
the ones named in the checks below matter.

## Twelve checks for step 2

Do these on an iPhone. Turn the numbers strip on first. Answer yes or no, or
read the number.

To make a long reply, ask "How do I start running?". To make a chat with
some history, ask it twice.

1. **The composer moves with the keyboard.** Tap the text field. Does the
   composer rise together with the keyboard, as one piece, with no jump?
   Does the last line of the strip say `keyboard moved by the phone`?
2. **A new chat opens the keyboard once.** Go back to the list and tap the
   button at the top right. Does the keyboard come up one time and stay up?
   (No is: it comes up, goes down and comes up again.)
3. **A tap outside puts the keyboard away.** With the keyboard up, tap a
   message. Does the keyboard go away? Tap the field to bring it back, then
   tap the round button beside the field while the field is empty. Does the
   keyboard stay up?
4. **The gap closes.** With the keyboard down, read `gap`. Is it 34? Tap
   the field. With the keyboard up, is `gap` 0, and does the composer sit
   just above the keyboard with no wide empty band between them?
5. **Nothing hides under the composer.** After a reply has ended, scroll to
   the very end. Is the last line fully visible above the composer? Tap the
   field and scroll to the end again. Is it still fully visible? Are `inset`
   and `bar covers` the same number both times?
6. **Send becomes Stop.** Send a question. While the reply is being
   written, is the round button dark with a small square in it? Tap it. Does
   the reply stop, with the word "Stopped" under it? Afterwards, type a
   letter: is the button blue with a whole arrow, point included?
7. **Your question goes to the top.** In a chat that has one answer
   already, send a question. Does your question move up to just under the
   title bar? Read `question y`. Is it between 15.5 and 16.5?
8. **Your question stays still.** While that reply grows, watch your
   question. Does it stay exactly where it is? When the reply has ended,
   read `drift`. Is it between -0.5 and +0.5?
9. **The round button to the end.** Let a long reply run off the bottom of
   the screen. Does a round button with a down arrow appear just above the
   composer? Tap the field: does the button rise with the composer, without
   jumping? Tap the button: does the list go to the end, and does the strip
   say `following`?
10. **Following stops and starts.** While the list follows a reply, rest a
    finger on the reply without moving it. Does the text stop moving under
    your finger, and move on when you lift it? Now drag the list up. Does it
    stay where you left it, and does the strip say `not following`? Scroll
    back down to the end. Does it say `following` again?
11. **A hold is counted.** While a reply is being written, hold a finger
    still on a message for one second, then lift. Did `holds` go up by one?
    Do it once with the keyboard down and once with it up.
12. **A saved chat opens at its end.** Go back to the list and open a chat
    that has several replies. Is the end of the chat on screen at once, with
    nothing seen to move? Does the strip say `at end`?

If a check fails, a photo of the screen with the strip on is the most useful
thing to send.

## Twenty checks for step 3

Do these on an iPhone, after a new build. Answer yes or no. Each takes a few
seconds.

To get ready: make two chats. In each, ask "How do I start running?" and
wait for the reply to end. In a third chat, ask "Should I take the train or
drive to the coast? Think it through." That one thinks before it answers.

**Holding a message**

1. **A menu opens.** Hold a finger still on a finished reply for one second.
   Do you feel a tap, and does a list slide up with Copy, Select text, Share
   and Write again?
2. **Copy.** Tap Copy. Does a line saying "Copied" show above the text
   field for two seconds? Open Notes and paste: is it the reply?
3. **With the keyboard up.** Tap the text field so the keyboard is up. Hold
   a message. Does the keyboard go down and the list come up, with the whole
   list in view and nothing hidden under the keyboard?
4. **While a reply is being written.** Ask "How do I start running?" again.
   While the reply is still growing, hold a finger on it. Does a list come
   up with Copy so far and Stop? Tap Stop: does the reply stop?
5. **Which way read the hold.** Turn the numbers strip on (hold the chat's
   title). Hold a message, then close the list. Read the last line of the
   strip. Does it say `native recogniser on` and `recognised by native`?
   (If it says `JS route` or `recognised by JS`, send a photo of the strip.)

**Sheets**

6. **Settings.** Go back to the list of chats. Tap the gear at the top
   left. Does a sheet slide up, titled Settings?
7. **The footer.** Is the Done button at the very bottom of the sheet,
   above the home indicator line, with the settings above it? (No is: Done
   is at the top, or in the middle.) Scroll the settings: does Done stay
   where it is?
8. **Dark.** Tap Dark. Does the whole app turn dark at once, the sheet and
   the title bar included? Tap System to put it back.
9. **Closing.** Swipe the sheet down. Does it close? Open it again and tap
   Done. Does it close?
10. **Reasoning.** Open the chat that thought first. Tap "Thought for ... s"
    above the reply. Does a sheet come up to half the screen's height, with
    the reasoning in it and Done at its bottom edge? Drag it up: does it go
    to full height?

**Delete, rename, search**

11. **Rename.** In the list, hold a chat for one second. Does a list come
    up with Rename and Delete? Tap Rename. Does a small sheet come up with
    the title in a text field and the keyboard up? Change it and tap Save.
    Does the row show the new title at once?
12. **Delete.** Hold a chat and tap Delete (it is red). Does the row go at
    once, and stay gone? (No is: it goes, comes back for a moment, and goes
    again.)
13. **From inside a chat.** Open a chat. Tap the button with three dots at
    the top right. Does a menu open with Rename, Settings and Delete? Tap
    Delete. Does the chat close, and is its row gone from the list?
14. **Search and headings.** Is there a heading "Today" above your chats?
    Pull the list down a little: does a search field show under the title?
    Type "running". Do only the chats about running stay?

**The microphone**

15. **Listening.** Open a chat. Tap the microphone button at the right of
    the text field. The first time, the phone asks twice: allow both. Say
    "what is the weather in Paris". Do the words appear in the field while
    you speak?
16. **Stopping.** Tap the microphone button again. Does it stop listening,
    with your words still in the field and a blue Send button beside it?
    Tap Send: does your message go?
17. **Refusing.** (Only if you want to test this: in the phone's Settings,
    find Effect Chat and turn Speech Recognition off.) Tap the microphone.
    Does a short line say that speech recognition is off, with the field
    left as it was?

**A voice note**

18. **Recording.** With the field empty, tap the button with the five small
    bars, left of the microphone. Does a red dot show with "Recording 0:00",
    and does the clock count up? Say a sentence, then tap the round button
    with the tick.
19. **Playing and sending.** Is there a small grey shape above the field
    that says "Voice note" and its length? Tap the small triangle in it: do
    you hear your recording? After a moment, are the words you said in the
    field? (If the field says "(Voice note, 0:05)" and stays that way, the
    phone could not read the words: say so.) Tap Send. Does your message
    show with the voice note's shape above its words?

**Small things**

20. **Glass, fade, taps.** Three in one. Scroll a long chat up: can you see
    the messages faintly through the shape around the text field? Does the
    round button with the down arrow fade in, and not pop in? When you tap
    Send, do you feel a light tap?

If a check fails, a photo of the screen with the numbers strip on is the
most useful thing to send.

Not built, so do not look for them: swiping a chat sideways in the list,
links in a reply opening in the browser, a new message rising into place,
and a crash screen. `docs/EFFECT_UI_CHAT.md` says why for each.

On Android the phone cannot move the composer itself. The app pads it up by
the keyboard's height, and the list gets shorter. Checks 1, 4 and 5 are for
iPhone only.

## What is in it

| Part | Program | What it does |
|---|---|---|
| The app | `chat/app.ts` | Owns the stack of screens. Hears when a reply ends |
| List of chats | `chat/parts/conversationList.ts` | The first screen, from a query |
| Chat screen | `chat/parts/chatScreen.ts` | One chat: title bar, transcript, composer, the round button. Sends and stops |
| Transcript | `chat/parts/transcript.ts` | The messages as a long list, and the numbers strip |
| Message row | `chat/parts/messageRow.ts` | One of your messages |
| Reply stream | `chat/parts/replyStream.ts` | One reply, saved or still being written |
| Composer | `chat/parts/composer.ts` | The text field, Send and Stop, the microphone, voice notes |
| Settings sheet | `chat/parts/settingsSheet.ts` | Light or dark, the pretend AI's switches, the numbers strip |
| Text sheet | `chat/parts/reasoningSheet.ts` | A reply's reasoning, or a message to select text in |
| Rename sheet | `chat/parts/renameSheet.ts` | One text field, Cancel and Save |
| Server data | `chat/data.ts` | What the app reads and writes, and the reply's stream |
| Events | `chat/events.ts` | Short lines one screen says for another to show |

The programs are in `packages/effect-ui-native/chat`. The app copies them,
with the host, into `./native` each time it starts
(`scripts/sync-eui-chat.sh`). `docs/EFFECT_UI_CHAT.md` explains the rest.

## Check it builds, without a phone

```
npm install
npx tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform ios --platform android --output-dir /tmp/eui-chat-export
```

Speech recognition is the package `expo-speech-recognition`, version 58.0.1,
which is the one made for Expo SDK 58. Its permission texts are in
`app.json`.

## Dev tools, links and the crash screen

Added after step 3. Run `npm install` once after pulling. The app does not
have to be built again.

- **Dev tools.** `npm run devtools` in this folder starts a page on your
  Mac, at `http://127.0.0.1:4774`, that shows everything the running app
  does. `docs/DEV_TOOLS.md` has the steps, what the page shows, and
  nineteen yes or no checks for an iPhone.
- **Links.** A link in a reply opens in the phone's browser.
- **Code blocks.** Copy on a code block puts the code on the clipboard and
  says "Copied".
- **If the app breaks.** It shows a screen that says so, with the error,
  Copy and Start again. Your chats are kept.
