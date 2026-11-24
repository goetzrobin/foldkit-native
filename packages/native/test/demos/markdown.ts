/**
 * The Streaming markdown demo.
 *
 * One screen. At the top, a line says which renderer draws the reply: the
 * native one (react-native-enriched-markdown, in the prebuilt app) or the
 * plain Foldkit fallback, and why. Under it, the controls:
 *
 * - "Stream it" plays the sample reply back token by token, as a language
 *   model sends it. "Stop" stops, "Show all" jumps to the end.
 * - Speed: slow, normal, fast, burst (many tokens at once).
 * - "Long reply" plays about 3,000 words, for a stress test.
 * - Renderer: native or Foldkit, to compare. The native chip says why when
 *   this build lacks it.
 * - Fade: new words fade in, or appear at once.
 * - "Close and reopen" draws the reply again from scratch, as reopening a
 *   chat does. Text already shown must not fade in again.
 * - "Show numbers": tokens so far, updates sent to the native view (at most
 *   one a frame), characters per update, time spent finishing half-written
 *   syntax.
 *
 * The reply itself: tap a link and the browser opens. Press Copy on a code
 * block and the line under the controls says what was copied. Long press
 * any text to select it. Switch the phone to dark mode and the reply
 * follows.
 */
import { Duration, Effect, type Layer, Schema, Stream } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Clipboard, ColorScheme, Linking, type Services } from '../../src/device/index.js'
import {
  type Device,
  header,
  onPress,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  testId,
  text,
  title,
  view as box,
} from '../../src/index.js'
import {
  type CodeCopy,
  isRemendConfigured,
  markdown,
  markdownNumbers,
  markdownRenderer,
  markdownStatus,
  resetMarkdownNumbers,
} from '../../src/markdown/index.js'
import { SAMPLE_REPLY, longReply, tokensOf, wordCount } from './markdownSample.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

const REPLY_ID = 'demo-reply'

const Speed = Schema.Literals(['slow', 'normal', 'fast', 'burst'])
type Speed = typeof Speed.Type

const Sample = Schema.Literals(['short', 'long'])
type Sample = typeof Sample.Type

const Renderer = Schema.Literals(['native', 'foldkit'])

/** How often a tick comes, and how many tokens each tick adds. */
const PACE: Readonly<Record<Speed, Readonly<{ everyMs: number; tokens: number }>>> = {
  slow: { everyMs: 120, tokens: 1 },
  normal: { everyMs: 40, tokens: 1 },
  fast: { everyMs: 15, tokens: 1 },
  burst: { everyMs: 60, tokens: 40 },
}

const tokensBySample: Readonly<Record<Sample, () => ReadonlyArray<string>>> = (() => {
  const cache = new Map<Sample, ReadonlyArray<string>>()
  const of = (sample: Sample) => () => {
    let found = cache.get(sample)
    if (found === undefined) {
      found = tokensOf(sample === 'short' ? SAMPLE_REPLY : longReply())
      cache.set(sample, found)
    }
    return found
  }
  return { short: of('short'), long: of('long') }
})()

const Numbers = Schema.Struct({
  renderer: Schema.String,
  textsGiven: Schema.Number,
  updatesSent: Schema.Number,
  lastUpdateChars: Schema.Number,
  remendMsAverage: Schema.Number,
  remendMsMax: Schema.Number,
  blocksRedrawn: Schema.Number,
})
type Numbers = typeof Numbers.Type

// MODEL

export const Model = Schema.Struct({
  sample: Sample,
  /** How many tokens of the sample are shown. */
  shown: Schema.Number,
  isStreaming: Schema.Boolean,
  speed: Speed,
  renderer: Renderer,
  isFadeOn: Schema.Boolean,
  isNumbersShown: Schema.Boolean,
  numbers: Numbers,
  scheme: ColorScheme.Scheme,
  /** Goes up by one on "Close and reopen": the reply is drawn from scratch. */
  opened: Schema.Number,
  /** What the last link or copy did, in words. */
  lastAction: Schema.String,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedStream: { sample: Sample },
  PressedStop: {},
  PressedShowAll: {},
  PressedSpeed: { speed: Speed },
  PressedRenderer: { renderer: Renderer },
  PressedToggleFade: {},
  PressedToggleNumbers: {},
  PressedReopen: {},
  TickedStream: {},
  GotNumbers: { numbers: Numbers },
  PressedLink: { url: Schema.String },
  PressedCopyCode: { code: Schema.String, language: Schema.String, isOnClipboard: Schema.Boolean },
  GotLinkingMessage: { message: Linking.Message },
  GotClipboardMessage: { message: Clipboard.Message },
  GotColorSchemeMessage: { message: ColorScheme.Message },
  PressedExit: {},
  CompletedExit: {},
})
export type Message = typeof Message.Type

const ZERO: Numbers = {
  renderer: 'native',
  textsGiven: 0,
  updatesSent: 0,
  lastUpdateChars: 0,
  remendMsAverage: 0,
  remendMsMax: 0,
  blocksRedrawn: 0,
}

const readNumbers = (): Numbers => {
  const found = markdownNumbers(REPLY_ID)
  return {
    renderer: found.renderer,
    textsGiven: found.textsGiven,
    updatesSent: found.updatesSent,
    lastUpdateChars: found.lastUpdateChars,
    remendMsAverage: found.remendRuns === 0 ? 0 : found.remendMs / found.remendRuns,
    remendMsMax: found.remendMsMax,
    blocksRedrawn: found.blocksRedrawn,
  }
}

const lineCount = (code: string): number => (code === '' ? 0 : code.split('\n').length)

// UPDATE

type Return = Update.Return<Model, Message, Services>

const makeUpdate = (env: DemoEnv) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  const flip = (flag: boolean): boolean => !flag
  const fromLinking = (message: Linking.Message) => Message.GotLinkingMessage({ message })
  const fromClipboard = (message: Clipboard.Message) => Message.GotClipboardMessage({ message })

  return (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      PressedStream: ({ sample }) => {
        resetMarkdownNumbers(REPLY_ID)
        return {
          model: modifyFields(model, {
            sample: () => sample,
            shown: () => 0,
            isStreaming: () => true,
            numbers: () => ZERO,
            // A new reply is a new view, as in a chat.
            opened: count => count + 1,
          }),
        }
      },
      PressedStop: () => ({ model: modifyFields(model, { isStreaming: () => false }) }),
      PressedShowAll: () => ({
        model: modifyFields(model, {
          shown: () => tokensBySample[model.sample]().length,
          isStreaming: () => false,
        }),
      }),
      PressedSpeed: ({ speed }) => ({ model: modifyFields(model, { speed: () => speed }) }),
      PressedRenderer: ({ renderer }) => ({ model: modifyFields(model, { renderer: () => renderer }) }),
      PressedToggleFade: () => ({ model: modifyFields(model, { isFadeOn: flip }) }),
      PressedToggleNumbers: () => ({ model: modifyFields(model, { isNumbersShown: flip }) }),
      PressedReopen: () => ({ model: modifyFields(model, { opened: count => count + 1 }) }),
      TickedStream: () => {
        const total = tokensBySample[model.sample]().length
        const shown = Math.min(total, model.shown + PACE[model.speed].tokens)
        return {
          model: modifyFields(model, { shown: () => shown, isStreaming: () => shown < total }),
        }
      },
      GotNumbers: ({ numbers }) => ({ model: modifyFields(model, { numbers: () => numbers }) }),
      PressedLink: ({ url }) => ({
        model: modifyFields(model, { lastAction: () => `Opening ${url}` }),
        commands: [Command.mapMessage(Linking.OpenUrl({ url }), fromLinking)],
      }),
      PressedCopyCode: ({ code, language, isOnClipboard }) => {
        const said = `Copied ${lineCount(code)} lines of ${language === '' ? 'code' : language}`
        // The native view's Copy button has already put the code on the
        // clipboard. The fallback's has not.
        return isOnClipboard
          ? { model: modifyFields(model, { lastAction: () => said }) }
          : {
              model: modifyFields(model, { lastAction: () => said }),
              commands: [Command.mapMessage(Clipboard.CopyText({ text: code }), fromClipboard)],
            }
      },
      GotLinkingMessage: ({ message: answer }) =>
        answer._tag === 'FailedOpenUrl'
          ? { model: modifyFields(model, { lastAction: () => `Could not open the link: ${answer.reason}` }) }
          : { model },
      GotClipboardMessage: ({ message: answer }) =>
        answer._tag === 'FailedCopyText'
          ? { model: modifyFields(model, { lastAction: () => `Copy failed: ${answer.reason}` }) }
          : { model },
      GotColorSchemeMessage: ({ message: answer }) => ({
        model: modifyFields(model, { scheme: () => answer.scheme }),
      }),
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
    })
}

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    sample: 'short',
    shown: 0,
    isStreaming: false,
    speed: 'normal',
    // Native where the build has it: the status line says when it does not.
    renderer: 'native',
    isFadeOn: true,
    isNumbersShown: false,
    numbers: ZERO,
    scheme: 'light',
    opened: 0,
    lastAction: '',
  },
})

// SUBSCRIPTIONS

const subscriptions = Subscription.make<Model, Message, ColorScheme.ColorScheme>()(entry => ({
  colorScheme: ColorScheme.changesEntry(message => Message.GotColorSchemeMessage({ message })),
  // Ticks only while the reply streams. Each tick adds some tokens.
  stream: entry(
    { isStreaming: Schema.Boolean, speed: Speed },
    {
      modelToDependencies: model => ({ isStreaming: model.isStreaming, speed: model.speed }),
      dependenciesToStream: ({ isStreaming, speed }) =>
        Stream.when(
          Stream.tick(Duration.millis(PACE[speed].everyMs)).pipe(
            Stream.drop(1),
            Stream.map(() => Message.TickedStream()),
          ),
          Effect.sync(() => isStreaming),
        ),
    },
  ),
  // The numbers change every frame, outside the Model. They are read a few
  // times a second while they are shown, not on every frame.
  numbers: entry(
    { isNumbersShown: Schema.Boolean },
    {
      modelToDependencies: model => ({ isNumbersShown: model.isNumbersShown }),
      dependenciesToStream: ({ isNumbersShown }) =>
        Stream.when(
          Stream.tick(Duration.millis(250)).pipe(
            Stream.mapEffect(() => Effect.sync(() => Message.GotNumbers({ numbers: readNumbers() }))),
          ),
          Effect.sync(() => isNumbersShown),
        ),
    },
  ),
}))

// VIEW

type Palette = Readonly<{ paper: string; ink: string; muted: string; line: string; chip: string; accent: string }>

const PALETTES: Readonly<Record<'light' | 'dark', Palette>> = {
  light: { paper: '#ffffff', ink: '#111111', muted: '#6b6b70', line: '#e5e5ea', chip: '#f2f2f4', accent: '#c2410c' },
  dark: { paper: '#000000', ink: '#f5f5f7', muted: '#98989f', line: '#2c2c30', chip: '#1c1c1e', accent: '#f97316' },
}

const chip = (palette: Palette, id: string, label: string, isOn: boolean, message: Message): Html =>
  box(
    [
      testId(id),
      onPress(message),
      style({
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: isOn ? palette.ink : palette.line,
        backgroundColor: isOn ? palette.ink : palette.chip,
      }),
    ],
    [text([style({ fontSize: 14, fontWeight: '600', color: isOn ? palette.paper : palette.ink })], [label])],
  )

const row = (children: ReadonlyArray<Html>): Html =>
  box([style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })], children)

const note = (palette: Palette, id: string, words: string): Html =>
  text([testId(id), style({ fontSize: 13, color: palette.muted, lineHeight: 18 })], [words])

const label = (palette: Palette, words: string): Html =>
  text([style({ fontSize: 12, fontWeight: '600', color: palette.muted, textTransform: 'uppercase', letterSpacing: 0.6 })], [words])

const numbersLine = (model: Model): string => {
  const n = model.numbers
  const total = tokensBySample[model.sample]().length
  const head = `Tokens ${model.shown} of ${total}`
  if (n.renderer === 'foldkit') {
    return `${head} · blocks redrawn on the last token: ${n.blocksRedrawn} · remend ${n.remendMsAverage.toFixed(2)} ms`
  }
  return [
    head,
    `texts given to the view ${n.textsGiven}`,
    `updates sent to native ${n.updatesSent} (at most one a frame)`,
    `last update ${n.lastUpdateChars.toLocaleString('en-US')} characters`,
    `remend ${n.remendMsAverage.toFixed(2)} ms average, ${n.remendMsMax.toFixed(2)} ms longest`,
    'parsing and fading: native code, not timed here',
  ].join(' · ')
}

const makeView =
  (env: DemoEnv) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const palette = PALETTES[model.scheme]
    const native = markdownRenderer('native')
    const tokens = tokensBySample[model.sample]()
    const reply = tokens.slice(0, model.shown).join('')
    const nativeLabel = native.renderer === 'native' ? 'Native' : 'Native (not in this build)'
    return stack(
      [testId('stack')],
      [
        screen(
          [h.Key('markdown'), testId('screen-markdown')],
          [
            header([title('Streaming markdown')], []),
            safeArea(env.device, { hasHeader: true }, [
              scrollView(
                [testId('markdown-scroll'), style({ flex: 1, backgroundColor: palette.paper })],
                [
                  box(
                    [style({ padding: 16, gap: 12 })],
                    [
                      text(
                        [testId('markdown-status'), style({ fontSize: 14, fontWeight: '600', color: palette.ink })],
                        [markdownStatus(model.renderer)],
                      ),
                      note(
                        palette,
                        'markdown-remend',
                        isRemendConfigured()
                          ? 'Half-written syntax: finished by remend before drawing'
                          : 'Half-written syntax: shown as it is (the app did not hand over remend)',
                      ),
                      row([
                        chip(palette, 'markdown-stream', model.isStreaming ? 'Streaming...' : 'Stream it', model.isStreaming && model.sample === 'short', Message.PressedStream({ sample: 'short' })),
                        chip(palette, 'markdown-long', `Long reply (${wordCount(longReplyText()).toLocaleString('en-US')} words)`, model.isStreaming && model.sample === 'long', Message.PressedStream({ sample: 'long' })),
                        chip(palette, 'markdown-stop', 'Stop', false, Message.PressedStop()),
                        chip(palette, 'markdown-show-all', 'Show all', false, Message.PressedShowAll()),
                      ]),
                      label(palette, 'Speed'),
                      row(
                        (['slow', 'normal', 'fast', 'burst'] as const).map(speed =>
                          chip(palette, `markdown-speed-${speed}`, speed[0]?.toUpperCase() + speed.slice(1), model.speed === speed, Message.PressedSpeed({ speed })),
                        ),
                      ),
                      label(palette, 'Renderer'),
                      row([
                        chip(palette, 'markdown-renderer-native', nativeLabel, model.renderer === 'native', Message.PressedRenderer({ renderer: 'native' })),
                        chip(palette, 'markdown-renderer-foldkit', 'Foldkit fallback', model.renderer === 'foldkit', Message.PressedRenderer({ renderer: 'foldkit' })),
                      ]),
                      ...(native.renderer === 'native'
                        ? []
                        : [note(palette, 'markdown-native-reason', `Native is not available: ${native.reason}`)]),
                      label(palette, 'Options'),
                      row([
                        chip(palette, 'markdown-fade', model.isFadeOn ? 'Fade: on' : 'Fade: off', model.isFadeOn, Message.PressedToggleFade()),
                        chip(palette, 'markdown-reopen', 'Close and reopen', false, Message.PressedReopen()),
                        chip(palette, 'markdown-numbers-toggle', 'Show numbers', model.isNumbersShown, Message.PressedToggleNumbers()),
                        chip(palette, 'exit', 'Exit', false, Message.PressedExit()),
                      ]),
                      ...(model.isNumbersShown ? [note(palette, 'markdown-numbers', numbersLine(model))] : []),
                      ...(model.lastAction === '' ? [] : [note(palette, 'markdown-last-action', model.lastAction)]),
                      box([style({ height: 1, backgroundColor: palette.line, marginVertical: 4 })], []),
                      // Keyed by `opened`: a new key is a new view, as reopening a chat is.
                      box(
                        [h.Key(`reply-${model.opened}`), testId('markdown-reply')],
                        [
                          model.shown === 0
                            ? note(palette, 'markdown-empty', 'Press "Stream it" to play a reply back.')
                            : markdown(h, {
                                id: REPLY_ID,
                                text: reply,
                                isStreaming: model.isStreaming,
                                colorScheme: model.scheme,
                                renderer: model.renderer,
                                fade: model.isFadeOn,
                                onLink: url => Message.PressedLink({ url }),
                                onCopyCode: (copy: CodeCopy) => Message.PressedCopyCode(copy),
                              }),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )
  }

const longReplyText = (): string => longReply()

/**
 * `resources` supplies the clipboard, links and the colour scheme:
 * `Phone.live({...})` in an app, `Phone.makeTest().layer` in a test.
 */
export const makeDemo = (container: HTMLElement, env: DemoEnv, resources: Layer.Layer<Services>) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env),
    view: makeView(env),
    subscriptions,
    resources,
    container,
  })
