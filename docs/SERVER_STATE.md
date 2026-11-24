# Server state

How a Foldkit program on the phone works with data that lives on a server.
The first part is for a reader who does not code. The appendix is for
engineers.

The code is in `packages/native/src/serverState/`. The demo is "Server state"
in the showcase menu. Nothing here has been seen on a real phone yet.

## What server state is

Some of what an app shows belongs to the app: which screen is open, what you
have typed so far. That is the Model, and the app is the only one who changes
it. The rest belongs to a server: the crew list, a member's name. The phone
only holds a copy, and the copy can be wrong at any moment because someone
else changed the original. A copy needs things the Model has no use for. It
has an age. It can be loading, or loading again while the old copy is still
shown. Two screens may want the same copy and should not fetch it twice. So
the copies are kept in their own place, a cache, and the Model keeps only
what a screen needs to draw.

## The four pieces

**Read atoms.** An atom is a small holder for one piece of loaded data, such
as "the crew list" or "member 3". It knows how to load itself, whether it is
loading, when it was loaded, and what went wrong if it failed. Ask for member
3 twice and you get the same atom, so the data is loaded once.

**Sync keys.** A sync key is a named topic, such as `crew:member-changed`.
When the app saves a change, it announces the topic. Every atom that listed
that topic loads itself again. The screen that saved does not need to know
which other screens are affected, and that is why the list behind an edit
screen updates with no code connecting the two.

**The Subscription bridge.** In Foldkit a screen cannot reach out and read
something. It declares a Subscription and receives Messages. The bridge turns
"while this screen is open, watch member 3" into a Subscription. Each time
the atom changes, the program gets a Message. When the screen closes, the
watching stops.

**The Command bridge.** In Foldkit a change to the outside world is a
Command. The bridge turns "save this name" into a Command that always answers
with a Message: it worked, or it failed and here is why. The save announces
its own sync key when it works.

## How they fit together

```
  THE PHONE                                              THE SERVER

  The Foldkit program
  +-------------------------------------------+
  |    view  <--  Model  <--  update          |
  |                            ^      |       |
  +----------------------------|------|-------+
                      Message  |      |  Command
  The bridge                   |      v
  +-------------------------------------------+
  |    watchAtom               |      runWrite|
  +----------------------------|------|-------+
                               |      |
  The cache                    |      v
  +-------------------------------------------+
  |                            |    write  ------------->  PUT /crew/3
  |                            |      |       |
  |                            |      v       |
  |    crew list  <--+---  sync key           |
  |    member 3   <--+     "crew:member-changed"
  |        |                                  |
  +--------|----------------------------------+
           +-------------------------------------------->  GET /crew
                                                           GET /crew/3
```

Start at the bottom. An atom (crew list, member 3) fetches from the server and holds the
answer. The bridge reports each change to the program as a Message. `update`
puts what the screen needs into the Model, and the view draws it. A write
goes the other way: a Command, the bridge, the server. Then the write
announces a sync key, and the atoms that care fetch again.

## Old data: stale, focus, and the idle time

Each atom has a rule for how old its data may be. The demo uses 30 seconds.
Data older than that is "stale". Stale data is still shown at once. It is
loaded again behind the scenes in two cases: when a screen opens it, and when
you come back to the app from somewhere else.

This is how the phone learns about a change made on another device. Nothing
pushes the change to the phone. The copy gets old, and the next look at it
fetches a new one.

When no screen is watching an atom, its data is kept for a while (5 minutes
unless set otherwise) and then dropped. Open the same member again within
that time and there is no request.

## How a screen is written

Three parts: say what to watch, handle what arrives, draw it.

```ts
// 1. The Subscription. While a member is open, watch that member.
member: watchAtom(
  { maybeOpenId: Schema.Option(Schema.Number) },
  {
    modelToDependencies: model => ({ maybeOpenId: model.maybeOpenId }),
    atom: ({ maybeOpenId }) => Option.map(maybeOpenId, crew.member),
    toMessage: result => Message.ChangedMember({ result }),
  },
),

// 2. The update branches. One for what the cache reports, three for a save.
ChangedMember: ({ result }) => ({
  model: { ...model, member: result, overlay: Optimistic.settle(model.overlay, result) },
}),
PressedSave: () => ({
  model: { ...model, overlay: Optimistic.begin(writeId, { name: model.draft }) },
  commands: [SaveName({ id, name: model.draft, writeId })],
}),
SucceededSave: ({ writeId }) => ({
  model: { ...model, overlay: Optimistic.confirm(model.overlay, writeId) },
}),
FailedSave: ({ writeId, reason }) => ({
  model: {
    ...model,
    overlay: Optimistic.rollBack(model.overlay, writeId),
    saveStatus: `Could not save: ${reason}. The old name was put back.`,
  },
}),

// 3. The view. Loading, failed, or the member with the unsaved name on top.
AsyncResult.match(model.member, {
  onInitial: () => text([], ['Loading…']),
  onFailure: () => retryButton,
  onSuccess: ({ value }) =>
    text([], [Optimistic.shown(model.overlay, value, (member, patch) => ({ ...member, ...patch })).name]),
})
```

The save itself is a Command made with `runWrite`:

```ts
const SaveName = Command.define('SaveName', {
  args: { id: Schema.Number, name: Schema.String, writeId: Schema.Number },
  messages: [Message.SucceededSave, Message.FailedSave],
  execute: ({ id, name, writeId }) =>
    runWrite(server, {
      fn: crew.rename,
      arg: { id, name },
      onSuccess: () => Message.SucceededSave({ writeId }),
      onFailure: failure => Message.FailedSave({ writeId, reason: describe(failure) }),
    }),
})
```

Nowhere does the save mention the list. The list's atom listed the topic
`crew:member-changed`, and `crew.rename` announces it.

## Optimistic writes

Waiting for the server before showing a new name feels slow. So the screen
shows the new name the moment you press Save, as a thin layer over what the
server last said. If the save works, the layer stays until fresh data arrives
and is then removed. If the save fails, the layer is removed at once, the old
name is back, and the screen says why. The layer is an ordinary field in the
Model, and the four small functions in `optimistic.ts` are all there is to it.

## Large lists

Putting 200 members into the Model each time the list changes means copying
200 members into a Message and comparing them on every update. The demo does
not do that. For the list, the Model holds a status, a count and a time. The
rows are drawn straight from the cache by our list component, which only
builds the rows near the screen. The Model's summary changes whenever the
cached list changes, and that is what tells Foldkit to draw again.

For something small, like one member, the whole result goes in the Model. It
is simpler and costs nothing.

## What is left out, on purpose

- **Pagination.** The list is fetched whole. Loading page after page as you
  scroll needs its own design.
- **An offline queue.** A save made with no network fails. It is not kept and
  tried again later.
- **Persistence.** The cache lives in memory. Close the app and it is gone.
- **Cross-device push.** The server does not tell the phone about changes. The
  phone finds out when its copy gets old and it looks again.

## Carrying an existing client layer

Suppose an app already has its server data written as atoms: a function that
takes a runtime and returns the read atoms and the write functions, with
`Atom.swr`, `Atom.family` and sync keys inside. That layer does not know what
draws the screen. To use it from Foldkit, three things are added around it
and nothing inside it changes:

1. Give its runtime to `makeServerState(runtime)` and put the result's
   `layer` into the Foldkit program's resources.
2. Give it the bridge's `focusSignal`, so coming back to the app reaches it.
3. For each screen, one `watchAtom` per thing it shows and one `runWrite`
   per thing it saves.

The bridge does not need this folder's `sync.ts`. A layer with its own topic
bus on Effect's `Reactivity` keeps it.

No existing layer has been run through this bridge yet. Two things need
checking when one is: the import paths (the atom modules are at
`effect/unstable/reactivity/*` in the 4.0 betas and at `effect/reactivity/*`
in 4.1), and the gap described under "A gap in Effect 4.1.0" below.

---

## Engineer's appendix

### Files

| File | What is in it |
|---|---|
| `src/serverState/sync.ts` | `makeSync(topics)`: `layer`, `invalidate`, `listen`, `reactivityKey`, `refreshOn` |
| `src/serverState/bridge.ts` | `makeServerState`, `watchAtom`, `runWrite`, `focusEntry`, `focusSignal`, the `ServerState` service |
| `src/serverState/optimistic.ts` | `Overlay`, `begin`, `confirm`, `rollBack`, `settle`, `shown` |
| `test/demos/serverStateCrew.ts` | The pretend server (`makeCrewServer`) and the client layer (`crewAtomsFor`) |
| `test/demos/serverState.ts` | The demo program |
| `test/serverState.test.ts` | Tests on the simulated phone |

Imports are `effect/reactivity/Atom`, `AtomRegistry`, `AsyncResult` and
`Reactivity` (Effect 4.1.0). No new packages.

### One registry and one runtime for each program

```ts
const runtime = Atom.runtime(Layer.mergeAll(api.layer, CrewSync.layer))
const crew = crewAtomsFor(runtime, { focusSignal })
const server = makeServerState(runtime, { idleTtl: '5 minutes' })

Runtime.makeElement({ ..., resources: Layer.mergeAll(server.layer, deviceLayer) })
```

- `server.layer` provides the `ServerState` service. Foldkit builds its
  `resources` Layer once into the runtime's scope. Building makes an
  `AtomRegistry` and mounts `runtime` in it. Closing the scope (the program is
  disposed) calls `registry.dispose()`, which interrupts requests in flight.
- The app's services are **not** in Foldkit's `resources`. They are in the
  Layer given to `Atom.runtime`, and the registry builds them once, with
  Effect's own `Reactivity` layer under them.
- A Command or Subscription that needs those services uses
  `server.provide(effect)` or `server.provideStream(stream)`. These read the
  runtime atom's built `Context` from the registry and provide it. So an
  `invalidate` run by a Command reaches the same `Reactivity` the atoms
  registered with. `runWrite` does this for you.
- `watchAtom` and `focusEntry` need only `ServerState` (and `AppState` for
  focus) and get it from `resources` in the usual way.

### What `watchAtom` does

It is a normal Subscription entry. `modelToDependencies` decides the key.
`dependenciesToStream` calls `registry.subscribe(atom, f, { immediate: true })`
inside `Stream.callback` with `acquireRelease`, so Foldkit stopping the Stream
unsubscribes. The first Message is the atom's current value, which is how a
cached value reaches the screen with no request. It arrives as a Message, so
a just-opened screen draws once in its loading state before it. Each later
change of the `AsyncResult` is another Message: `Initial`, `Success` with
`waiting` (refreshing with the old value), `Success`, `Failure` with
`previousSuccess`.

Two entries on the same atom share one registry node and one request.
`server.watcherCount(atom)` reports how many entries are running, for tests.

### Time

- Staleness and `AsyncResult.timestamp` use `Date.now()` inside Effect. They
  do not follow Effect's `Clock`. The tests move `Date` with vitest's fake
  timers (`toFake: ['Date']`).
- The pretend server's latency is `Effect.sleep`, which does follow `Clock`.
  The tests put a `TestClock` into the runtime's Layer (the demo's `extra`
  option) and call `clock.adjust`.
- Idle removal uses `setTimeout` in buckets (`timeoutResolution` is half the
  idle time). The transforms `swr`, `withReactivity` and `refreshOn` have no
  idle time of their own: they are removed as soon as nobody watches. Only
  the atom underneath, which holds the data, is kept.
- `Atom.swr` revalidates on mount and on the focus signal. It does not
  refetch on a timer while a screen sits open. The panel says "stale" then.

### A gap in Effect 4.1.0, and `refreshOn`

`Atom.runtime.withReactivity(keys)` wraps an atom in a transform that
registers with `Reactivity`. That transform is removed when the last watcher
leaves, while the data underneath is kept for its idle time. A key
invalidated in between reaches nobody. When a screen opens the atom again,
the cached value is returned with its old timestamp, and if it is younger
than the stale time it is shown as fresh and not refetched. A user could save
on one screen, open another within 30 seconds, and see the old data.

`CrewSync.refreshOn(...topics)` is `withReactivity` plus a repair. The bus
counts announcements for each registry. The wrapper notes the count when its
last watcher leaves and compares when it is watched again. If the count moved
it refreshes. The test "reloads a member that was closed when a topic was
announced" fails without it. `reactivityKey(topic)` is still exported for
code that wants plain `withReactivity`, with the gap.

This applies to any layer that uses `withReactivity` with an idle time.
Whether Effect intends it has not been checked with its authors.

### Optimistic writes, and their limit

`settle` drops a confirmed layer on the first `Success` that is not
`waiting`. If that fresh result reaches `update` before the write's own
success Message, the layer is confirmed afterwards and stays until the next
load. What it shows is what the server confirmed, so the screen is right. If
the write does not announce a topic, no fresh result comes and the layer
stays until the data is next loaded. The demo's "Announce topic: off" shows
this: the member screen has the new name and the list does not.

Effect also has `Atom.optimistic` and `Atom.optimisticFn`, which keep the
layer in the cache. This demo keeps it in the Model so the roll back is
visible in `update`. Both are valid.

### Writes

- `runWrite(server, { fn, arg, ... })` sets the argument on an atom made with
  `runtime.fn` and waits for its result. Such an atom runs one call at a
  time. A second call interrupts the first, and the first answers `Crashed`
  with "The write was cut short". Use `concurrent: true` on the atom, or the
  plain Effect form, when two may overlap.
- `runWrite(server, { effect, ... })` runs a plain Effect with the runtime's
  services.
- Failure is `{ _tag: 'Rejected', error }` for the typed error and
  `{ _tag: 'Crashed', reason }` for a defect or an interrupt. The Effect never
  fails, so a write cannot crash the program.

### Large lists and `peek`

`server.peek(atom)` returns what the registry node holds without reading the
atom, so it cannot start a request. The view calls it at draw time. This
makes the view depend on something outside the Model. It stays correct
because every change to the atom also sends `ChangedRoster` with a new
summary, which changes the Model and runs the view. If the summary were ever
equal for two different lists (same count, same timestamp to the
millisecond, same status), the view would not run again. Add a version
counter to the summary if that matters to you.

It was practical within the list's public API: `list` takes `items` as an
array on each draw and builds only the rows near the screen.

### On native

- Do not use `Atom.windowFocusSignal` or `Atom.refreshOnWindowFocus`. They
  read `document`. Use `focusSignal` from the bridge, fed by `focusEntry`.
- `Atom.family` uses `WeakRef` and `FinalizationRegistry` when both exist and
  a plain map when they do not. Which one Hermes takes has not been checked
  on a device.

### Tests

`test/serverState.test.ts` runs the demo on the simulated phone, then tests
the three files in `src/serverState` on their own. Twelve deliberate
breakages of the code were tried, one at a time, and each made at least one
test fail. The track report lists them. Run the file with:

```
cd packages/native
FOLDKIT_DIR=/home/claude/repos/fk/src NG_NATIVE_DIR=/home/claude/repos/ngn/src \
  node_modules/vitest/vitest.mjs run test/serverState.test.ts
```
