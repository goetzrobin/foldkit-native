# Dev tools

## In plain words

An Effect UI app writes down what it does while it runs. Every tap, every
piece of a reply that arrives, every job the app starts and how it ended is
written down, with what it changed. This record is called the message log.

The dev tools show the message log on a page in a browser on your Mac, while
the app runs on your phone. You do something on the phone and it appears on the
page a moment later. You can click any entry and see what the app knew at
that moment and what the entry changed.

The same tools let a coding agent, such as Claude Code, read the running app.
It can see what is on screen in the app's own terms and why. If you allow it,
it can also press things for you.

This works for both Effect UI apps: Effect Chat (`apps/eui-chat`) and the
playground (`apps/eui-playground`). It works only in a development build, the
kind you get from `npx expo run:ios`. An app built for release has none of it.

Three things are new here:

- A small piece in each app that sends the message log to your Mac.
- A command, `npm run devtools`, that starts the page on your Mac.
- A crash screen. If the app breaks, it says so, shows the error, and offers
  Copy and Start again. Your chats are kept.

Nothing here has been tried on a real phone yet. The checks at the end are
for that.

## Start it

You need the app built on your phone or in the simulator already. The app's
own README has those steps.

1. Open Terminal and go to the app's folder:

   ```
   cd apps/eui-chat
   npm install
   ```

   `npm install` is needed once after you pull these changes. The app does
   not have to be built again.

2. Start the dev tools:

   ```
   npm run devtools
   ```

   It prints this and then waits:

   ```
   Effect UI dev tools are running.

     Open this page in a browser on this Mac:  http://127.0.0.1:4774
     For a coding agent (MCP):                 http://127.0.0.1:4774/mcp
     Apps send to port 4775 of this Mac (192.168.1.20).
     A coding agent cannot send Messages into the app (add -- --dispatch to allow it).
   ```

   The first time, macOS may ask whether "node" may accept incoming
   connections. Choose Allow. Without it a phone cannot reach the Mac.

3. Open a second Terminal window, go to the same folder, and start the app
   as you always do:

   ```
   npm start
   ```

   Open the app on the phone. If it was open already, reload it: press `r`
   in the window where `npm start` runs.

4. On the Mac, open `http://127.0.0.1:4774` in a browser.

Leave both Terminal windows open. Control-C in the dev tools window stops
the dev tools. The app does not mind: it carries on, and connects again by
itself when you start them later.

The order does not matter. The app keeps its last 1,000 entries and sends
them when the dev tools appear.

## What the page shows, with Effect Chat

The page is Effect UI's own. It shows the newest app that connected and
follows it. Its parts, as Effect UI describes them:

| Part | What it is |
|---|---|
| Timeline | Every entry of the message log, newest at the top |
| Instances | The parts of the app that are on screen, such as the list of chats or one reply |
| Path | Where the selected entry's part sits in the app, such as `/App/ChatScreen[s1]/Composer[composer]` |
| Chain | What caused the selected entry, and what it caused in turn |
| Model | What that part of the app knew after the entry. Changed lines are marked |
| Lifecycle | The jobs that part started, and whether each ended, failed or is still going |

Try this:

1. In Effect Chat, start a new chat, type "How do I start running?" and
   press Send.
2. On the page, look at the timeline. Near the top you will see a great
   many entries called `ReceivedTurnUpdate`. Each is a few words of the
   reply arriving. Below them, find `PressedSend`. That is your tap.
3. Click `PressedSend`. The path reads `/App/ChatScreen[s1]/Composer[composer]`:
   the app, the chat screen in it, the composer in that. The Model shows
   what the composer knew after the tap. The lines the tap changed are
   marked. Look for `draft`, the text in the field.
4. Look at the chain. Your tap made the composer tell the chat screen
   (`Submitted`). The chat screen started a job called `chat/SendMessage`
   and asked the phone for a small tap under your finger (`Phone/Impact`).
5. Click one `ReceivedTurnUpdate`. Its path ends in `ReplyStream`. The
   Model shows the reply as far as it had been written at that moment.
6. To see only one part of the app, click a piece of the path. The timeline
   then shows that part and what is inside it.

If the app crashes, the entry is in the timeline too, called `Failed`, with
the error. When you press Start again on the phone, the app shows up as a
new session.

## For a coding agent

A coding agent connects to the dev tools over MCP. Put this in the agent's
MCP settings. For Claude Code that is a file named `.mcp.json` in the folder
you start it from. This repo does not have one, so that nobody's agent
connects without meaning to.

```json
{
  "mcpServers": {
    "effect-ui": { "type": "http", "url": "http://127.0.0.1:4774/mcp" }
  }
}
```

Start `npm run devtools` first, then the agent. It can then:

| Tool | What it answers | Works with a phone app |
|---|---|---|
| `list_sessions` | Which apps are connected | Yes |
| `list_instances` | The parts of the app that are on screen | Yes |
| `list_entries`, `count_entries` | The message log, as short rows | Yes |
| `get_entry` | One entry in full | Yes |
| `get_chain` | What caused an entry and what it caused | Yes |
| `get_state` | What a part of the app knows now, or knew at an entry | Yes |
| `diff_state` | What an entry changed | Yes |
| `get_message_schema` | What a part of the app can be told | Yes |
| `wait` | Waits for the jobs an entry started to end | Yes |
| `dispatch` | Tells a part of the app something, as a tap would | Yes, if you start the tools with `npm run devtools -- --dispatch` |
| `show_entry` | Shows the app as it was at an entry | No. See below |
| `resume` | Goes back to the live app | Answers yes. There is never anything to go back from |

`dispatch` is off unless you ask for it, because it makes the real app do
real things: with Effect Chat it could send a message or delete a chat.

## What does not work on a phone, and why

- **Time travel.** On a web page the tools can show the page as it was at
  any entry. They do it by drawing a second copy of the page next to the
  real one. Effect UI can only do that for web pages. For a phone the page
  has no Time travel button, and an agent that asks gets a plain answer
  that says so. You can still read what the app knew at any entry.
- **The overlay.** A web app gets a small dev tools button inside the page
  itself. A phone app has none. The page on the Mac is the only view.
- **The page's label for the app.** The page calls the app's host
  "terminal". Effect UI has names for web pages, servers, terminals and
  tests, and none for a phone yet. "terminal" is its name for an app with
  no web page.
- **A Mac that changes network.** The app finds the Mac by the address it
  loaded its code from. If you move the Mac to another network, reload the
  app.

## Which phones can connect

| Where the app runs | What to do |
|---|---|
| iPhone simulator | Nothing. It shares the Mac's network |
| iPhone on the same Wi-Fi as the Mac | Nothing, if you chose Allow when macOS asked |
| Android emulator | Nothing. It reaches the Mac at `10.0.2.2` |
| Android phone on a USB cable | Run `adb reverse tcp:4775 tcp:4775` once, as is done for Metro's own port |
| A phone on mobile data, or another Wi-Fi | It cannot connect |

An iPhone on a cable with Wi-Fi off cannot connect either. Metro needs the
network for a real iPhone too, so this is not new.

## Is it safe on a shared Wi-Fi?

The page and the agent's address (port 4774) answer only to programs on
your Mac. Nobody else on the network can open them. Effect UI's server has
no setting to change that.

A phone is another machine, so a second port is open for it: 4775. An app
can send its message log to that port. Nothing can be read from it. The
page, the agent's address and everything the tools hold cannot be reached
through it.

What somebody on the same Wi-Fi could do while `npm run devtools` runs:
send made-up entries, which would show on your page as one more app. They
could not see your app, your chats or your screen. There is no password.

On a network you do not trust, such as a café's, start it this way. Only
simulators on the Mac can then connect:

```
npm run devtools -- --local
```

## React Native's own tools

These come with React Native 0.88 and Expo SDK 58. They know nothing of
Effect UI. They are good for other things: what the app printed, stopping
the code on a line, what it sent over the network.

To open them, press `j` in the Terminal window where `npm start` runs. A
window called React Native DevTools opens on the Mac.

None of this was run here: there is no phone or simulator on the machine
this was written on. "Read" below means the answer comes from the code of
the installed versions.

| Tool | How to open it | Does it work for these apps? | How we know |
|---|---|---|---|
| Console: what the app printed | `j`, then Console | Should work. It reads the JavaScript engine, not React | Read. Not tested |
| Sources: stop the code on a line of TypeScript | `j`, then Sources | Should work. Metro gives the tools a map from the running code back to the TypeScript files | Read. Not tested |
| Network: what the app sent and got back | `j`, then Network | Should show `fetch` requests. Expo switches this panel on. Effect Chat's pretend AI runs inside the app and sends nothing, so the list will be nearly empty | Read. Not tested |
| Network: WebSocket lines, such as the one to the dev tools | `j`, then Network | No. React Native 0.88 has this behind a switch that is off (`fuseboxWebSocketEventsEnabled`) | Read |
| Memory: what the app holds | `j`, then Memory | Should work. It reads the JavaScript engine | Read. Not tested |
| Performance: a recording of what the app did | `j`, then Performance | Should record JavaScript. The rows about React will be empty | Read. Not tested |
| Components and Profiler | `j`, then Components | Empty. These two show React's tree, and React draws nothing here | Read |
| Dev menu | Shake the phone, or press `m` in the Terminal | Opens. It is part of React Native, not of React | Read. Not tested |
| Dev menu: Reload | In the dev menu, or `r` in the Terminal | Works. The app starts from the beginning | Read. Not tested |
| Dev menu: Open DevTools | In the dev menu | Same as `j` | Read. Not tested |
| Dev menu: Toggle Element Inspector | In the dev menu | Does nothing. React draws that inspector, and React draws nothing here | Read |
| Dev menu: Show Perf Monitor | In the dev menu | Should work. The phone's own code draws it: memory, and frames a second | Read. Not tested |
| Dev menu: Fast Refresh | In the dev menu | A saved file reloads the whole app. Fast Refresh keeps what is on screen only for React components | Read. Not tested |

## Checks to try on an iPhone

Each has a yes or no answer. Start `npm run devtools` and open the page
first. The iPhone and the Mac must be on the same Wi-Fi.

1. **It connects.** Open Effect Chat, then reload the page in the browser.
   Does the page show a timeline with entries in it?
2. **A tap shows up.** Tap the pencil for a new chat. Does `PressedNewChat`
   appear at the top of the timeline within a second?
3. **You can see what changed.** Send a message. Click `PressedSend` on the
   page. Is a line of the Model marked as changed?
4. **A reply streams on the page.** While a reply is being written, do new
   `ReceivedTurnUpdate` entries keep arriving?
5. **The app does not need the tools.** Press Control-C in the dev tools
   window. Does the app carry on as before, with no message on screen?
6. **It comes back.** Run `npm run devtools` again and reload the page in
   the browser. Does the app show up again within about ten seconds,
   without touching the phone?
7. **Late is fine.** Stop the dev tools. Send a message on the phone. Start
   the dev tools and reload the page. Is that message's `PressedSend` in
   the timeline?
8. **A link opens.** Ask "How do I start running?" and wait for the reply
   to end. Tap the link "NHS Couch to 5K" at the end. Does the browser open?
9. **A code block copies.** In the same reply, tap Copy on the code block.
   Do you feel a light tap and see "Copied" above the text field? Paste
   into Notes: is it the code, whole?
10. **While it streams.** Ask the same question again. Tap Copy on the code
    block before the reply has ended. Does "Copied" show?
11. **A hold on a link.** Hold your finger on the link. Does the message
    menu open (Copy, Select text, Share), and nothing else?
12. **The crash screen.** In the playground: open Phone, scroll to the
    bottom, tap "in update". Do you see "Something went wrong", the error
    in a grey box, and two buttons? Can you read every line, with no line
    on top of another?
13. **Copy on the crash screen.** Tap Copy. Does the button say "Copied"?
    Paste into Notes: is the error there?
14. **Start again.** Tap Start again. Are you back at the menu?
15. **The other two.** Do "in view" and "in a Command" show the same
    screen?
16. **Dark.** Set the iPhone to dark mode, then make a crash. Is the screen
    dark, with pale text?
17. **React Native's tools.** Press `j` in the `npm start` window. Does a
    window open on the Mac? Does its Console show a line when you reload the
    app?
18. **A breakpoint.** In that window, open Sources, find `counter.ts`, and
    click the line number beside `PressedIncrement`. In the playground, open
    Counter and tap Plus. Does the app stop, with that line marked?
19. **The dev menu.** Shake the phone. Does a menu open? Does Show Perf
    Monitor put a small panel of numbers on screen?

## What was tested, and what was not

Tested here, on a simulated phone in Node, with the real dev tools server
and a real WebSocket (`packages/effect-ui-native/test/devtools.test.ts`):

- The app's session, its parts, its entries and a part's state are all on
  the server, read the way an agent reads them, over MCP.
- The page is served, and the feed the page reads carries the app's entries.
- `dispatch` changes what is on the simulated phone's screen. A Message that
  is not one of the part's own is refused and changes nothing.
- `show_entry` says plainly that a phone app cannot be shown that way.
- A crash is in the log, and the app that starts again is a new session.
- With no server: the app starts and works, nothing is reported as an
  error, and each of its two connections is tried at most five times in the
  first 2.5 seconds.
- A server started after the app gets what the app did before.
- The port for phones passes on an app's two connections, also when they
  name another machine as their origin. It refuses the page, the agent's
  address and the page's feed.

Not tested:

- Anything on a real phone or a simulator.
- The page in a real browser. Its parts are described above from Effect
  UI's own documentation.
- React Native's WebSocket in place of Node's. The two have the same
  shape, read from React Native's code.
- That a real iPhone's build knows the Mac's address. React Native writes
  it into a development build made for a device.
- The macOS firewall question.
- Every row of the React Native table.

Checked for a release build: the dev tools code is not in it. Both apps
were exported for release (`npx expo export`, iOS and Android) and the
bundles were searched for four pieces of text that only the dev tools
contain. None was found. The same search in a development export finds all
of them. Effect UI's own `MessageLog.socket` is in every bundle, because it
is part of `@effect/ui`. In a release build nothing calls it.

## For an engineer

| What | Where |
|---|---|
| The Layer that sends the log and answers the server | `packages/effect-ui-native/src/NativeDevTools.ts` |
| The crash screen and its supervisor | `packages/effect-ui-native/src/NativeCrash.ts` |
| Who is told about each mounted tree | `packages/effect-ui-native/src/internal/roots.ts` |
| The server script and the relay | `scripts/eui-devtools.mjs` |
| The vendored server | `packages/effect-ui-native/vendor/effect-ui-devtools-0.0.0.tgz` |
| Where each app switches it on | `apps/eui-chat/index.ts`, `apps/eui-playground/index.ts`, inside `if (__DEV__)` |
| Tests | `test/devtools.test.ts` (11), `test/crash.test.ts` (12), `test/chatLinks.test.ts` (7) |

How it fits together:

- **The log.** `NativeDevTools.layer({ server })` provides Effect UI's
  `MessageLog` through `MessageLog.socket`, the same call
  `DevToolsHeadless.layer` makes, with a `WebSocketConstructor` over the
  global `WebSocket`. `effect/socket/Socket` needs `readyState`,
  `addEventListener` with `once`, `removeEventListener`, `close(code)`,
  `send(text)` and a `binaryType` it can set. React Native's class has all
  of them.
- **The address.** `serverFromBundle(scriptURL)` takes the host from
  `SourceCode.scriptURL`, read through `TurboModuleRegistry`, and puts the
  dev tools port on it. No React, no Expo package.
- **The control connection.** A web page's dev tools open a second WebSocket,
  `/control`, over which the server sends requests. `NativeDevTools` opens
  the same one and answers `MessageSchema` and `Dispatch`. For that it
  needs each mounted tree: `NativeHost.mountEffect` tells a `Roots` service
  about every tree, and `NativeDevTools` provides its own.
- **The relay.** Effect UI's server listens on 127.0.0.1 and has no option
  for another address. It also answers 403 to a WebSocket whose `Origin`
  names another machine, and iOS and Android both send one, made from the
  address. The relay listens on every address of the Mac, takes only
  WebSocket upgrades for `/log` and `/control`, removes `Origin`, and
  passes the bytes to 127.0.0.1.
- **The crash screen.** Effect UI writes a `Failed` entry to the message
  log when `init`, `update` or `view` throws, or a Command, Subscription or
  Mount dies. `NativeCrash.screen()` puts a watcher in front of whichever
  log the app was given, and on the first `Failed` closes the app's Scope
  and mounts `CrashScreen` on the same surface. Start again closes that and
  mounts the app anew. The Layers the app was given are untouched.

Workarounds, each marked in the code:

1. **Two functions of a mounted tree are used that its public type does
   not name**: `find(instance)` and `dispatch(instance, message)`. Effect
   UI's web host uses the same two for the same purpose. If they change,
   `dispatch` answers that the session is not on screen, and reading still
   works.
2. **The control connection's message shapes are written out by hand.** They are
   in `@effect/ui-devtools/src/internal/control.ts`, which the package does
   not export.
3. **The control connection does not use `Socket.readerString`.** It needs
   `TextDecoder`, which the phone's JavaScript engine may not have. Text
   frames arrive as strings anyway.
4. **The session's host is "terminal".** See above.
5. **The crash watcher keeps the message log switched on in a release
   build.** With no log, Effect UI skips building entries. With the watcher
   it builds each one and the watcher looks at its name. Nothing is encoded
   or kept. The cost on a phone has not been measured.
6. **`@effect/ui-kit` is marked an optional peer** in the vendored
   package. See `packages/effect-ui-native/vendor/patches/README.md`.

For Effect UI's maintainers:

- `DevToolsServer.layer` could take a `host`, and the origin check could
  allow a list. The relay exists only because of these two.
- `WireHost` could have a name for a native host.
- A host other than the web one has no public way to offer its trees for
  `dispatch`. `BrowserHost.Controllables` is the web host's. A
  `Renderer.Root` with `find` and `dispatch` in its type would be enough.
- Time travel needs `paintDom`. A `paint` on `Renderer.Host` would let
  other hosts do it.
