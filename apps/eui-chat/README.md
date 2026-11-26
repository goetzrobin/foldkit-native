# Effect Chat

Fold Chat, built again on Effect UI. It draws with the phone's own views and
React draws nothing. This is step 1 of three: the list of chats, opening a
chat, reading it, and sending a message that gets a streamed reply.

The replies come from a pretend AI inside the app. It knows a few topics and
writes its answers a few letters at a time, as a real one does. No network
is needed.

Nobody has run this app on a phone yet. It was built and tested on a laptop,
where a simulated phone can check what the app asks for but cannot show how
it looks or feels.

## Build it on your iPhone

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
   chat", with "Ask anything" and three questions?
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
   While it is being written, is the round button grey?
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

Not in step 1, so do not look for them: the field moving smoothly with the
keyboard, the list following a growing reply by itself, the button that
scrolls to the end, Stop, menus, sheets, delete, rename, search, settings
and voice notes. A long reply runs off the bottom of the screen: scroll to
read it.

## What is in it

| Part | Program | What it does |
|---|---|---|
| The app | `chat/app.ts` | Owns the stack of screens. Hears when a reply ends |
| List of chats | `chat/parts/conversationList.ts` | The first screen, from a query |
| Chat screen | `chat/parts/chatScreen.ts` | One chat: title bar, transcript, composer. Sends |
| Transcript | `chat/parts/transcript.ts` | The messages as a long list |
| Message row | `chat/parts/messageRow.ts` | One of your messages |
| Reply stream | `chat/parts/replyStream.ts` | One reply, saved or still being written |
| Composer | `chat/parts/composer.ts` | The text field and Send |
| Server data | `chat/data.ts` | What the app reads and writes, and the reply's stream |

The programs are in `packages/effect-ui-native/chat`. The app copies them,
with the host, into `./native` each time it starts
(`scripts/sync-eui-chat.sh`). `docs/EFFECT_UI_CHAT.md` explains the rest.

## Check it builds, without a phone

```
npm install
npx tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 npx expo export --platform ios --platform android --output-dir /tmp/eui-chat-export
```
