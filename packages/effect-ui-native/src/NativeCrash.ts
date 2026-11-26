/**
 * What the phone shows when the app breaks, and how the app starts again.
 *
 *   NativeHost.mount(App, props, { fabric, rootTag, crash: NativeCrash.screen({ hint: 'Your chats are saved.' }) })
 *
 * Effect UI stops a component whose `init`, `update` or `view` throws, or
 * whose Command, Subscription or Mount dies. It draws nothing in its place
 * and writes a `Failed` entry to the message log. This module listens to the
 * log. On the first `Failed` entry it takes the whole app off the screen and
 * mounts a small program of its own in its place: a line that says what
 * happened, the error in a box that scrolls, Copy, and Start again.
 *
 * Start again mounts the app from the start, with a new Model. The Layers
 * the app was given (the server, the files, the phone's services) are the
 * same ones as before, so what the app had saved is still there.
 *
 * Every size here is in points. A line height is a number of points too, not
 * a factor: a web value such as 1.5 would put every line on top of the last.
 */
import * as Command from '@effect/ui/Command'
import * as MessageLog from '@effect/ui/MessageLog'
import type * as Renderer from '@effect/ui/Renderer'
import * as UiSchema from '@effect/ui/UiSchema'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'

import * as Native from './Native.js'
import * as Phone from './Phone.js'

/** What the screen shows and what Copy puts on the clipboard. */
export const Report = Schema.Struct({
  /** One plain sentence: what the app was doing. */
  what: Schema.String,
  /** Where it happened, for a developer: the component, the step, the Message or Command. */
  where: Schema.String,
  /** The error's name, such as `TypeError`. */
  name: Schema.String,
  message: Schema.String,
  /** The stack, top first, one entry per line. */
  stack: Schema.Array(Schema.String),
})
export type Report = typeof Report.Type

/** How many lines of the stack the screen shows. Copy takes all of them. */
export const STACK_LINES = 12

const WHAT: Readonly<Record<string, string>> = {
  init: 'The app stopped while it was opening a screen.',
  update: 'The app stopped while it was handling something you did.',
  view: 'The app stopped while it was drawing the screen.',
  content: 'The app stopped while it was drawing the screen.',
  command: 'The app stopped while it was working on something.',
  subscription: 'The app stopped while it was listening for news.',
  mount: 'The app stopped while it was setting up a part of the screen.',
  layer: 'The app stopped while it was getting a part of itself ready.',
}

const tagOf = (value: unknown): string | undefined => {
  const tag = (value as { _tag?: unknown } | null | undefined)?._tag
  return typeof tag === 'string' ? tag : undefined
}

/** The stack's own lines, without a first line that only repeats the name and message. */
const stackOf = (error: Error): ReadonlyArray<string> => {
  const lines = (error.stack ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const first = lines[0] ?? ''
  return first.startsWith(error.name) || first === error.message ? lines.slice(1) : lines
}

/** Reads a `Failed` entry of the message log. */
export const reportOf = (entry: MessageLog.Failed): Report => {
  const error = Cause.squash(entry.cause)
  const message = tagOf(entry.update?.message)
  const detail =
    message !== undefined
      ? `, handling ${message}`
      : entry.name !== undefined
        ? entry.in === 'command'
          ? `, running ${entry.name}`
          : ` (${entry.name})`
        : ''
  return {
    what: WHAT[entry.in] ?? 'The app stopped because of a mistake in its code.',
    where: `${entry.path} failed in ${entry.in}${detail}`,
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : typeof error === 'string' ? error : String(tagOf(error) ?? error),
    stack: error instanceof Error ? stackOf(error) : [],
  }
}

/** The report as text, for the clipboard: the error, where, and the whole stack. */
export const reportText = (report: Report): string =>
  [`${report.name}: ${report.message}`, report.where, ...report.stack].join('\n')

// THE SCREEN

type Palette = Readonly<{ bg: string; box: string; ink: string; ink2: string; button: string; onButton: string }>

const LIGHT: Palette = { bg: '#FFFFFF', box: '#F2F2F3', ink: '#0D0D0E', ink2: '#5C5C63', button: '#0D0D0E', onButton: '#FFFFFF' }
const DARK: Palette = { bg: '#0B0B0C', box: '#1C1C1E', ink: '#F4F4F5', ink2: '#A1A1A8', button: '#F4F4F5', onButton: '#0B0B0C' }

/** How long the Copy button says "Copied". */
export const COPIED_MS = 2000

/** What Start again runs. The supervisor provides it. */
export class Restart extends Command.Service<Restart>()('NativeCrash/Restart', {
  args: {},
  success: Schema.Void,
}) {}

const CrashMessage = UiSchema.TaggedEnum({
  PressedCopy: {},
  CompletedCopy: { outcome: Phone.Outcome },
  WaitedAfterCopy: {},
  PressedRestart: {},
  AskedForRestart: {},
  ChangedScheme: { scheme: Phone.Device.ColorScheme.Scheme },
})

const WaitAfterCopy = Command.make('NativeCrash/WaitAfterCopy', { args: {} }, () =>
  Effect.as(Effect.sleep(`${COPIED_MS} millis`), CrashMessage.WaitedAfterCopy()),
)

export const CrashScreenProps = Schema.Struct({
  report: Report,
  /** A line under the box, such as what is still safe. */
  hint: Schema.String,
})

/**
 * The crash screen as a program of its own. It replaces the whole app, so
 * no title bar or safe area is around it: the padding at the top and bottom
 * keeps it clear of the notch and the home indicator.
 */
export const CrashScreen = Native.component({
  name: 'CrashScreen',
  props: CrashScreenProps,
  model: Schema.Struct({
    copy: Schema.Literals(['idle', 'copied', 'failed']),
    isRestarting: Schema.Boolean,
    scheme: Phone.Device.ColorScheme.Scheme,
  }),
  message: CrashMessage,
}).make({
  init: () => ({ copy: 'idle' as const, isRestarting: false, scheme: 'light' as const }),
  update: {
    PressedCopy: $ =>
      $.run(
        Phone.Copy.make({ text: reportText($.props.report) }).pipe(
          Command.map(outcome => CrashMessage.CompletedCopy({ outcome })),
        ),
      ),
    CompletedCopy: ($, { outcome }) =>
      $.evolve({ copy: outcome._tag === 'Done' ? ('copied' as const) : ('failed' as const) }).run(WaitAfterCopy.make({})),
    WaitedAfterCopy: $ => $.evolve({ copy: 'idle' as const }),
    // One press starts the app once.
    PressedRestart: $ => ($.model.isRestarting ? $.model : $.evolve({ isRestarting: true }).run(Restart.make().pipe(Command.as(CrashMessage.AskedForRestart())))),
    AskedForRestart: $ => $.model,
    ChangedScheme: ($, { scheme }) => $.evolve({ scheme }),
  },
  subscriptions: () => [Phone.colorScheme(scheme => CrashMessage.ChangedScheme({ scheme }))],
  view: (h, model) => {
    const { report, hint } = h.props
    const palette = model.scheme === 'dark' ? DARK : LIGHT
    const stack = report.stack.slice(0, STACK_LINES)
    const button = (id: string, words: string, isMain: boolean, message: typeof CrashMessage.Type) =>
      h.pressable
        .testId(id)
        .set({ accessibilityRole: 'button', accessibilityLabel: words })
        .style({
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 48,
          borderRadius: 12,
          backgroundColor: isMain ? palette.button : palette.box,
        })
        .pressedStyle({ opacity: 0.6 })
        .on('press', message)
        .children(
          h.text
            .style({ fontSize: 16, lineHeight: 21, fontWeight: '600', color: isMain ? palette.onButton : palette.ink })
            .children(words),
        )
    return h.view
      .testId('crash-screen')
      .style({
        flex: 1,
        flexDirection: 'column',
        backgroundColor: palette.bg,
        paddingTop: 72,
        paddingHorizontal: 20,
        paddingBottom: 40,
        gap: 12,
      })
      .children(
        h.text
          .testId('crash-title')
          .style({ fontSize: 22, lineHeight: 28, fontWeight: '600', color: palette.ink })
          .children('Something went wrong'),
        h.text.testId('crash-what').style({ fontSize: 16, lineHeight: 22, color: palette.ink2 }).children(report.what),
        // The box takes the room that is left and scrolls inside it, so a
        // long error never pushes the buttons off the screen.
        h.scrollView
          .testId('crash-details')
          .style({ flex: 1, backgroundColor: palette.box, borderRadius: 12 })
          .set({ contentStyle: { flexDirection: 'column', padding: 14, gap: 8 } })
          .children(
            h.text
              .testId('crash-message')
              .set({ selectable: true })
              .style({ fontSize: 15, lineHeight: 21, fontWeight: '500', color: palette.ink })
              .children(`${report.name}: ${report.message}`),
            h.text
              .testId('crash-where')
              .set({ selectable: true })
              .style({ fontSize: 13, lineHeight: 18, color: palette.ink2 })
              .children(report.where),
            stack.length === 0
              ? null
              : h.text
                  .testId('crash-stack')
                  .set({ selectable: true })
                  .style({ fontSize: 12, lineHeight: 17, color: palette.ink2 })
                  .children(stack.join('\n')),
          ),
        hint === ''
          ? null
          : h.text.testId('crash-hint').style({ fontSize: 14, lineHeight: 20, color: palette.ink2 }).children(hint),
        h.view
          .testId('crash-buttons')
          .style({ flexDirection: 'row', gap: 12 })
          .children(
            button(
              'crash-copy',
              model.copy === 'copied' ? 'Copied' : model.copy === 'failed' ? 'Could not copy' : 'Copy',
              false,
              CrashMessage.PressedCopy(),
            ),
            button('crash-restart', 'Start again', true, CrashMessage.PressedRestart()),
          ),
      )
  },
})

// THE SUPERVISOR

/** What the crash screen itself needs from the app's Layers. */
export type Needs = Phone.Copy | Phone.Device.ColorScheme.ColorScheme

/** What `NativeHost.mountEffect` hands the supervisor. */
export type MountHooks<Model, Msg> = Readonly<{
  /** Mounts the app. It writes to whichever message log is in its context. */
  mountApp: Effect.Effect<Renderer.Root<Model, Msg>, never, Scope.Scope>
  /** Mounts another program in the app's place. */
  mountOther: (component: unknown, props: unknown) => Effect.Effect<Renderer.Root<any, any>, never, Scope.Scope>
}>

/** The `crash` option of `NativeHost.mount`. Make one with `screen`. */
export interface Supervisor<R> {
  readonly supervise: <Model, Msg>(
    hooks: MountHooks<Model, Msg>,
  ) => Effect.Effect<Renderer.Root<Model, Msg>, never, Scope.Scope | R>
}

export type ScreenOptions = Readonly<{
  /** A line under the error. Say what is still safe, if anything is. */
  hint?: string
  /** Hears every crash, for a log of the app's own. */
  onCrash?: (report: Report) => void
}>

/**
 * Shows the crash screen when any part of the app fails, and starts the app
 * again from it.
 */
export const screen = (options: ScreenOptions = {}): Supervisor<Needs> => ({
  supervise: <Model, Msg>({ mountApp, mountOther }: MountHooks<Model, Msg>) =>
    Effect.gen(function* () {
      const owner = yield* Effect.scope
      // The log the app was given, such as the dev tools'. It keeps getting every entry.
      const outer = yield* MessageLog.MessageLog
      const crashes = yield* Queue.unbounded<Report>()
      const restarts = yield* Queue.unbounded<void>()
      let current: Renderer.Root<Model, Msg> | undefined

      const startApp = Effect.gen(function* () {
        const scope = yield* Scope.fork(owner)
        let hasCrashed = false
        const watcher: MessageLog.MessageLog = {
          enabled: true,
          record: entry => {
            // The first failure is the one to show. What fails after it fails because of it.
            if (entry._tag !== 'Failed' || hasCrashed) return
            hasCrashed = true
            Queue.offerUnsafe(crashes, reportOf(entry))
          },
        }
        current = yield* mountApp.pipe(
          Effect.provideService(MessageLog.MessageLog, MessageLog.fanoutAll([outer, watcher])),
          Scope.provide(scope),
        )
        return scope
      })

      const restartLayer = Restart.toLayer(
        Effect.succeed(() => Effect.sync(() => void Queue.offerUnsafe(restarts, undefined))),
      )

      let appScope = yield* startApp
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            const report = yield* Queue.take(crashes)
            options.onCrash?.(report)
            current = undefined
            yield* Scope.close(appScope, Exit.void)
            const screenScope = yield* Scope.fork(owner)
            const restart = yield* Layer.build(restartLayer).pipe(Scope.provide(screenScope))
            yield* mountOther(CrashScreen, { report, hint: options.hint ?? '' }).pipe(
              Effect.provideContext(restart),
              // The crash screen is not part of the app's story.
              Effect.provideService(MessageLog.MessageLog, MessageLog.noop),
              Scope.provide(screenScope),
            )
            yield* Queue.take(restarts)
            yield* Scope.close(screenScope, Exit.void)
            appScope = yield* startApp
          }),
        ),
      )

      // The app's tree changes with every start. This always speaks for the one on screen.
      const root: Renderer.Root<Model, Msg> = {
        get path() {
          return current?.path ?? ''
        },
        get session() {
          return current?.session ?? ''
        },
        model: () => current?.model(),
        send: message => current?.send(message),
        adopted: Effect.void,
      }
      return root
    }),
})
