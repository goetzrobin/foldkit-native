/**
 * Streaming Markdown on the simulated phone.
 *
 * The native route: the native view is asked for by its real name with the
 * props react-native-enriched-markdown's native code reads, half-written
 * syntax is finished by remend before it is sent, at most one new text goes
 * per frame, text already on screen never fades in again, and the view's
 * link and copy events become Messages. The fallback: blocks drawn with
 * plain views, finished blocks left alone. Then the demo, pressed through.
 *
 * The simulated phone cannot draw the native view. These tests check what
 * the phone was asked to draw.
 */
import type { FakeFabric, FakeFabricNode } from '@ng-native/testing/fake'
import { Schema } from 'effect'
import { Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Source, streamOf } from '../src/host/device/common.js'
import { Phone, configureMotion, registerNavigation, stopMotion, view } from '../src/index.js'
import {
  type CodeCopy,
  NATIVE_MARKDOWN_VIEW,
  NEEDS_PREBUILT,
  REMEND_OPTIONS,
  configureMarkdown,
  forgetFallback,
  isNativeMarkdownAvailable,
  markdown,
  markdownNumbers,
  markdownRenderer,
  markdownStatus,
  markdownTheme,
  nativeMarkdownUnavailableReason,
  resetMarkdownNumbers,
  resetMarkdownSetup,
} from '../src/markdown/index.js'
import { splitBlocks } from '../src/foldkit/markdown/fallback.js'
import { makeDemo } from './demos/markdown.js'
import { SAMPLE_REPLY, longReply, tokensOf, wordCount } from './demos/markdownSample.js'
import { type Phone as TestPhone, byTestId, flatten, hasTestId, press, settle, startPhone, textOf } from './support/phone.js'

// remend is the app's dependency, not this package's: the tests load the
// copy `npm install` put in the showcase app.
const { default: remend } = (await import(
  // @ts-expect-error: a plain JavaScript file outside this package, with no types here.
  '../../../apps/showcase/node_modules/remend/dist/index.js'
)) as { default: (text: string, options?: object) => string }

const nativeViews = (fabric: FakeFabric): Array<FakeFabricNode> =>
  flatten(fabric.committed).filter(node => node.viewName === NATIVE_MARKDOWN_VIEW)

const onlyNativeView = (fabric: FakeFabric): FakeFabricNode => {
  const found = nativeViews(fabric)
  expect(found).toHaveLength(1)
  return found[0] as FakeFabricNode
}

/** A build that has the native view, or one that does not. */
const setUp = (hasNative: boolean, withRemend = true): void => {
  resetMarkdownSetup()
  resetMarkdownNumbers()
  forgetFallback()
  configureMarkdown({ hasComponent: name => hasNative && name === 'EnrichedMarkdown', remend: withRemend ? remend : null })
}

afterEach(() => {
  resetMarkdownSetup()
  delete (globalThis as { __nativeComponentRegistry__hasComponent?: unknown }).__nativeComponentRegistry__hasComponent
})

// A small program around one `markdown`, driven by the test.

const Model = Schema.Struct({
  text: Schema.String,
  isStreaming: Schema.Boolean,
  scheme: Schema.Literals(['light', 'dark']),
  isFadeOn: Schema.Boolean,
  isShown: Schema.Boolean,
  renderer: Schema.Literals(['auto', 'foldkit', 'native']),
  links: Schema.Array(Schema.String),
  copies: Schema.Array(Schema.String),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  GotText: { text: Schema.String, isStreaming: Schema.Boolean },
  SwitchedScheme: { scheme: Schema.Literals(['light', 'dark']) },
  SwitchedFade: { isFadeOn: Schema.Boolean },
  SwitchedShown: { isShown: Schema.Boolean },
  PressedLink: { url: Schema.String },
  CopiedCode: { code: Schema.String, language: Schema.String, isOnClipboard: Schema.Boolean },
})
type Message = typeof Message.Type

type Driver = Readonly<{
  send: (message: Message) => Promise<void>
  /** Sends without waiting for the draw: for many Messages in a row. */
  sendQuickly: (message: Message) => Promise<void>
  model: () => Model
  dispose: () => void
}>

const start = async (phone: TestPhone, initial: Partial<Model> = {}): Promise<Driver> => {
  // Messages come in through a Subscription, as a phone's events do.
  const listeners = new Set<(message: Message) => void>()
  const source: Source<Message> = {
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  let latest: Model | undefined
  const update = (model: Model, message: Message): Update.Return<Model, Message> =>
    Message.match<Update.Return<Model, Message>>(message, {
      GotText: ({ text, isStreaming }) => ({
        model: modifyFields(model, { text: () => text, isStreaming: () => isStreaming }),
      }),
      SwitchedScheme: ({ scheme }) => ({ model: modifyFields(model, { scheme: () => scheme }) }),
      SwitchedFade: ({ isFadeOn }) => ({ model: modifyFields(model, { isFadeOn: () => isFadeOn }) }),
      SwitchedShown: ({ isShown }) => ({ model: modifyFields(model, { isShown: () => isShown }) }),
      PressedLink: ({ url }) => ({ model: modifyFields(model, { links: links => [...links, url] }) }),
      CopiedCode: ({ code, isOnClipboard }) => ({
        model: modifyFields(model, { copies: copies => [...copies, `${isOnClipboard}:${code}`] }),
      }),
    })
  const viewOf = (model: Model, h: HtmlBuilder<Message>): Html => {
    latest = model
    return view(
      [h.Attribute('testID', 'root')],
      model.isShown
        ? [
            markdown(h, {
              id: 'reply',
              text: model.text,
              isStreaming: model.isStreaming,
              colorScheme: model.scheme,
              fade: model.isFadeOn,
              renderer: model.renderer,
              onLink: url => Message.PressedLink({ url }),
              onCopyCode: (copy: CodeCopy) => Message.CopiedCode(copy),
            }),
          ]
        : [],
    )
  }
  const program = Runtime.makeElement({
    Model,
    init: () => ({
      model: {
        text: '',
        isStreaming: true,
        scheme: 'light',
        isFadeOn: true,
        isShown: true,
        renderer: 'auto',
        links: [],
        copies: [],
        ...initial,
      },
    }),
    update,
    view: viewOf,
    subscriptions: Subscription.make<Model, Message>()(() => ({
      test: Subscription.persistentEntry(streamOf('test', source)),
    })),
    container: phone.surface.container,
  })
  const handle = Runtime.embed(program)
  await settle()
  return {
    send: async message => {
      for (const listener of listeners) listener(message)
      await settle()
    },
    sendQuickly: async message => {
      for (const listener of listeners) listener(message)
      await new Promise(resolve => setTimeout(resolve, 1))
    },
    model: () => latest as Model,
    dispose: () => handle.dispose(),
  }
}

describe('finding the native view', () => {
  it('is there when React Native says the component is in the build', () => {
    setUp(true)
    expect(isNativeMarkdownAvailable()).toBe(true)
    expect(markdownRenderer('auto')).toEqual({ renderer: 'native', reason: '' })
    expect(markdownStatus()).toBe('Renderer: native (react-native-enriched-markdown)')
  })

  it('reads React Native’s own registry function when told nothing else', () => {
    resetMarkdownSetup()
    const asked: Array<string> = []
    ;(globalThis as { __nativeComponentRegistry__hasComponent?: unknown }).__nativeComponentRegistry__hasComponent = (
      name: string,
    ) => {
      asked.push(name)
      return true
    }
    expect(isNativeMarkdownAvailable()).toBe(true)
    expect(asked).toEqual(['EnrichedMarkdown'])
  })

  it('is not there in Expo Go, and says what to do', () => {
    setUp(false)
    expect(isNativeMarkdownAvailable()).toBe(false)
    expect(nativeMarkdownUnavailableReason()).toBe(NEEDS_PREBUILT)
    expect(markdownRenderer('native').renderer).toBe('foldkit')
    expect(markdownStatus('native')).toBe(`Renderer: Foldkit fallback, because ${NEEDS_PREBUILT}`)
  })

  it('is not there when the registry cannot be asked, or asking throws', () => {
    resetMarkdownSetup()
    configureMarkdown({ hasComponent: null })
    expect(isNativeMarkdownAvailable()).toBe(false)
    expect(nativeMarkdownUnavailableReason()).toContain('cannot be read')
    configureMarkdown({
      hasComponent: () => {
        throw new Error('boom')
      },
    })
    expect(isNativeMarkdownAvailable()).toBe(false)
    expect(nativeMarkdownUnavailableReason()).toBe('looking for the native view failed (boom)')
  })

  it('can be switched off by the app, and the Foldkit renderer can be chosen', () => {
    setUp(true)
    configureMarkdown({ native: false })
    expect(markdownRenderer().renderer).toBe('foldkit')
    expect(nativeMarkdownUnavailableReason()).toBe('switched off by the app')
    configureMarkdown({ native: 'detect' })
    expect(markdownRenderer('foldkit')).toEqual({ renderer: 'foldkit', reason: 'chosen' })
  })
})

describe('the native route', () => {
  let phone: TestPhone
  let frames: Array<() => void>
  let driver: Driver

  const runFrame = async (): Promise<void> => {
    const due = frames.splice(0)
    for (const run of due) run()
    await settle()
  }

  beforeEach(() => {
    setUp(true)
    registerNavigation()
    phone = startPhone()
    frames = []
    configureMotion(phone.surface, { requestFrame: run => frames.push(run) })
  })

  afterEach(async () => {
    driver.dispose()
    await settle()
    stopMotion(phone.surface)
    phone.surface.dispose()
  })

  it('draws the native view by name with every prop its native code reads', async () => {
    driver = await start(phone, { text: '# Hi\n\nSome *words*.', isStreaming: false })
    const props = onlyNativeView(phone.fabric).props
    expect(props['markdown']).toBe('# Hi\n\nSome *words*.')
    expect(props['isGFM']).toBe(true)
    expect(props['md4cFlags']).toMatchObject({ latexMath: true, admonitions: true, strikethrough: false })
    expect(props['streamingConfig']).toEqual({ tableMode: 'progressive', codeBlockMode: 'progressive', mediaMode: 'progressive' })
    expect(props['selectionMenuConfig']).toMatchObject({ copyLabel: 'Copy', copyAsMarkdown: true })
    expect(props['accessibilityLabels']).toMatchObject({ list: { bulletPoint: 'Bullet point' } })
    expect(props['linkRecognition']).toMatchObject({ text: { isDisabled: true } })
    expect(props['selectable']).toBe(true)
    expect(props['streamingAnimation']).toBe(false)
    expect(props['enableTaskListItemToggle']).toBe(false)
    const style = props['markdownStyle'] as Record<string, Record<string, unknown>>
    // Every block of MarkdownStyleInternal (the package's
    // src/EnrichedMarkdownNativeComponent.ts), none left for native code to guess.
    expect(Object.keys(style).sort()).toEqual(
      [
        'paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'list', 'codeBlock', 'link',
        'linkVariants', 'strong', 'em', 'strikethrough', 'underline', 'code', 'image', 'video',
        'inlineImage', 'thematicBreak', 'table', 'taskList', 'math', 'inlineMath', 'spoiler',
        'superscript', 'subscript', 'highlight',
      ].sort(),
    )
    expect(Object.keys(style['codeBlock']?.['syntaxColors'] as object)).toHaveLength(14)
    expect(style['paragraph']).toMatchObject({ fontSize: 16, fontFamily: 'System', lineHeight: 24 })
    expect(style['codeBlock']).toMatchObject({ fontFamily: 'Menlo' })
  })

  it('uses Android’s font names and taller lines there', async () => {
    phone.surface.dispose()
    phone = startPhone('android')
    configureMotion(phone.surface, { requestFrame: run => frames.push(run) })
    driver = await start(phone, { text: 'Hello', isStreaming: false })
    const style = onlyNativeView(phone.fabric).props['markdownStyle'] as Record<string, Record<string, unknown>>
    expect(style['paragraph']).toMatchObject({ fontFamily: 'sans-serif', lineHeight: 26 })
    expect(style['codeBlock']).toMatchObject({ fontFamily: 'monospace' })
  })

  it('sends at most one new text a frame while streaming, always the newest', async () => {
    driver = await start(phone, { text: '', isStreaming: true })
    await runFrame()
    let text = ''
    for (const token of ['Hello', ' there', ',', ' this', ' is', ' a', ' **reply']) {
      text += token
      await driver.send(Message.GotText({ text, isStreaming: true }))
    }
    // Seven texts, no frame yet: nothing new has gone to native code.
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe('')
    await runFrame()
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe('Hello there, this is a **reply**')
    const numbers = markdownNumbers('reply')
    expect(numbers.textsGiven).toBe(8)
    // One when the view was made (empty), one for the frame.
    expect(numbers.updatesSent).toBe(2)
    expect(numbers.lastUpdateChars).toBe('Hello there, this is a **reply**'.length)
    expect(numbers.remendRuns).toBe(1)
  })

  it.each([
    ['an unclosed bold', 'Some **bold', 'Some **bold**'],
    ['an unclosed italic and code', 'an *ital and `code', 'an *ital and `code`*'],
    ['half a link: its words show, not its brackets', 'Read [the notes](https://foldk', 'Read the notes'],
    ['an image with half an address: left out until complete', 'See ![a road](https://pics', 'See '],
    // Half a code fence and half a table are left as they are: the native
    // view draws both as far as they have got (streamingConfig 'progressive').
    ['half a code fence', '```ts\nconst a = 1', '```ts\nconst a = 1'],
    ['half a table', '| a | b |\n| --- | --- |\n| 1 | 2', '| a | b |\n| --- | --- |\n| 1 | 2'],
  ])('finishes %s before sending', async (_name, cut, sent) => {
    driver = await start(phone, { text: '', isStreaming: true })
    await driver.send(Message.GotText({ text: cut, isStreaming: true }))
    await runFrame()
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe(sent)
  })

  it('sends the text as it is when there is no remend', async () => {
    setUp(true, false)
    driver = await start(phone, { text: '', isStreaming: true })
    await driver.send(Message.GotText({ text: 'Some **bold', isStreaming: true }))
    await runFrame()
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe('Some **bold')
  })

  it('sends the finished text at once and whole, and lets it be selected', async () => {
    driver = await start(phone, { text: '', isStreaming: true })
    await runFrame()
    expect(onlyNativeView(phone.fabric).props['selectable']).toBe(false)
    await driver.send(Message.GotText({ text: 'Done **now', isStreaming: false }))
    // No frame needed, and no remend: the model's own words.
    const props = onlyNativeView(phone.fabric).props
    expect(props['markdown']).toBe('Done **now')
    expect(props['selectable']).toBe(true)
    // The fade stays on so the last words finish fading.
    expect(props['streamingAnimation']).toBe(true)
  })

  it('fades only text that arrives after the first draw', async () => {
    driver = await start(phone, { text: '', isStreaming: true })
    // The first draw has the fade off; it is turned on right after.
    expect(phone.fabric.committed.length).toBeGreaterThan(0)
    await settle()
    expect(onlyNativeView(phone.fabric).props['streamingAnimation']).toBe(true)
  })

  it('does not fade a finished reply again when its chat is reopened', async () => {
    driver = await start(phone, { text: SAMPLE_REPLY, isStreaming: false })
    await runFrame()
    expect(onlyNativeView(phone.fabric).props['streamingAnimation']).toBe(false)
    await driver.send(Message.SwitchedShown({ isShown: false }))
    expect(nativeViews(phone.fabric)).toHaveLength(0)
    await driver.send(Message.SwitchedShown({ isShown: true }))
    await runFrame()
    const props = onlyNativeView(phone.fabric).props
    expect(props['streamingAnimation']).toBe(false)
    expect(props['markdown']).toBe(SAMPLE_REPLY)
  })

  it('does not fade what was there when a chat is reopened mid-stream, only what comes after', async () => {
    driver = await start(phone, { text: 'Half of a', isStreaming: true, isShown: false })
    // Every commit's fade setting, as the phone receives it.
    const fades: Array<unknown> = []
    const complete = phone.fabric.completeRoot.bind(phone.fabric)
    ;(phone.fabric as { completeRoot: typeof complete }).completeRoot = (...args) => {
      complete(...args)
      for (const node of nativeViews(phone.fabric)) fades.push(node.props['streamingAnimation'])
    }
    await driver.send(Message.SwitchedShown({ isShown: true }))
    // The view arrives holding the text there already, with the fade off...
    expect(fades[0]).toBe(false)
    // ...and the fade is on from the next commit, for what comes after.
    expect(fades.at(-1)).toBe(true)
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe('Half of a')
  })

  it('turns the fade off and on with the fade option', async () => {
    driver = await start(phone, { text: 'A', isStreaming: true })
    await driver.send(Message.SwitchedFade({ isFadeOn: false }))
    expect(onlyNativeView(phone.fabric).props['streamingAnimation']).toBe(false)
    await driver.send(Message.SwitchedFade({ isFadeOn: true }))
    expect(onlyNativeView(phone.fabric).props['streamingAnimation']).toBe(true)
  })

  it('follows light and dark, and sends a theme only when it changes', async () => {
    driver = await start(phone, { text: 'Hi', isStreaming: false })
    const light = onlyNativeView(phone.fabric).props['markdownStyle']
    await driver.send(Message.GotText({ text: 'Hi there', isStreaming: false }))
    expect(onlyNativeView(phone.fabric).props['markdownStyle']).toBe(light)
    await driver.send(Message.SwitchedScheme({ scheme: 'dark' }))
    const dark = onlyNativeView(phone.fabric).props['markdownStyle'] as Record<string, Record<string, unknown>>
    expect(dark).not.toEqual(light)
    expect(onlyNativeView(phone.fabric).props['selectionColor']).toBeDefined()
  })

  it('turns a link press and a copy press into Messages', async () => {
    driver = await start(phone, { text: '[x](https://foldkit.dev)', isStreaming: false })
    const node = onlyNativeView(phone.fabric)
    phone.fabric.emit(node, 'topLinkPress', { url: 'https://foldkit.dev' })
    phone.fabric.emit(node, 'topCopyPress', { code: 'let a = 1', language: 'swift' })
    await settle()
    expect(driver.model().links).toEqual(['https://foldkit.dev'])
    expect(driver.model().copies).toEqual(['true:let a = 1'])
  })

  it('stops sending after it is gone', async () => {
    driver = await start(phone, { text: '', isStreaming: true })
    await driver.send(Message.GotText({ text: 'More text', isStreaming: true }))
    await driver.send(Message.SwitchedShown({ isShown: false }))
    const sentBefore = markdownNumbers('reply').updatesSent
    await runFrame()
    expect(markdownNumbers('reply').updatesSent).toBe(sentBefore)
    expect(nativeViews(phone.fabric)).toHaveLength(0)
  })

  it('costs one remend a frame on a 3,000-word reply, not one a token', async () => {
    const tokens = tokensOf(longReply())
    expect(wordCount(longReply())).toBeGreaterThanOrEqual(3000)
    driver = await start(phone, { text: '', isStreaming: true })
    let text = ''
    // Forty tokens arrive between frames, as in burst mode.
    for (let at = 0; at < 400; at++) {
      text += tokens[at] ?? ''
      await driver.sendQuickly(Message.GotText({ text, isStreaming: true }))
      if (at % 40 === 39) await runFrame()
    }
    const numbers = markdownNumbers('reply')
    // Foldkit may fold Messages that come close together into one draw, so
    // the view saw many texts but not always one per token.
    expect(numbers.textsGiven).toBeGreaterThan(40)
    // One when the view was made (empty), then one a frame.
    expect(numbers.updatesSent).toBe(11)
    expect(numbers.remendRuns).toBe(10)
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe(remend(text, REMEND_OPTIONS))
  }, 60_000)
})

describe('the Foldkit fallback', () => {
  let phone: TestPhone
  let driver: Driver | undefined

  beforeEach(() => {
    setUp(false)
    phone = startPhone()
  })

  afterEach(async () => {
    driver?.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('cuts a reply into paragraphs and code, an open fence running to the end', () => {
    expect(splitBlocks('One\ntwo\n\n```ts\ncode\n```\n\nThree\n\n```\nopen').map(block => [block.kind, block.body])).toEqual([
      ['text', 'One\ntwo'],
      ['code', 'code'],
      ['text', 'Three'],
      ['code', 'open'],
    ])
  })

  it('draws words without their marks, headings, and code with a Copy button', async () => {
    driver = await start(phone, {
      text: '# Title\n\nSome **bold** and [a link](https://x.dev).\n\n```ts\nconst a = 1\n```',
      isStreaming: false,
    })
    expect(nativeViews(phone.fabric)).toHaveLength(0)
    expect(textOf(byTestId(phone.fabric, 'reply-block-0'))).toBe('Title')
    expect(textOf(byTestId(phone.fabric, 'reply-block-1'))).toBe('Some bold and a link.')
    expect(textOf(byTestId(phone.fabric, 'reply-block-2'))).toContain('const a = 1')
    await press(phone.fabric, 'reply-block-2-copy')
    expect(driver.model().copies).toEqual(['false:const a = 1'])
  })

  it('redraws only the last block while streaming', async () => {
    driver = await start(phone, { text: 'First paragraph.\n\nSecond', isStreaming: true })
    const first = byTestId(phone.fabric, 'reply-block-0')
    await driver.send(Message.GotText({ text: 'First paragraph.\n\nSecond one', isStreaming: true }))
    expect(markdownNumbers('reply').blocksRedrawn).toBe(1)
    expect(byTestId(phone.fabric, 'reply-block-0')).toBe(first)
    expect(textOf(byTestId(phone.fabric, 'reply-block-1'))).toBe('Second one')
  })

  it('finishes a half-written link before drawing', async () => {
    driver = await start(phone, { text: 'Read [the no', isStreaming: true })
    expect(textOf(byTestId(phone.fabric, 'reply-block-0'))).toBe('Read the no')
  })

  it('is used for the native renderer where the build lacks it, and when chosen', async () => {
    setUp(true)
    driver = await start(phone, { text: 'Hi', isStreaming: false, renderer: 'foldkit' })
    expect(nativeViews(phone.fabric)).toHaveLength(0)
    expect(hasTestId(phone.fabric, 'reply-block-0')).toBe(true)
  })
})

describe('the theme', () => {
  it('has a light and a dark set, and takes changes', () => {
    expect(markdownTheme('light').colors.text).not.toBe(markdownTheme('dark').colors.text)
    expect(markdownTheme('dark', { colors: { link: '#00ff00' } }).colors.link).toBe('#00ff00')
    // Asked twice the same way, the same object: an unchanged theme is not sent again.
    expect(markdownTheme('dark', { sizes: { body: 18 } })).toBe(markdownTheme('dark', { sizes: { body: 18 } }))
  })

  it('has no purple in it, code colours included', () => {
    const purple = (hex: string): boolean => {
      const value = Number.parseInt(hex.slice(1, 7), 16)
      const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
      return b > g + 40 && r > g + 40
    }
    for (const scheme of ['light', 'dark'] as const) {
      const { syntax, ...rest } = markdownTheme(scheme).colors
      for (const color of [...Object.values(rest), ...Object.values(syntax)]) {
        expect(purple(color), `${scheme} ${color}`).toBe(false)
      }
    }
  })
})

describe('the Streaming markdown demo', () => {
  let phone: TestPhone
  let device: ReturnType<typeof Phone.makeTest>
  let handle: { dispose: () => void }
  let exit: ReturnType<typeof vi.fn<() => void>>

  const begin = async (): Promise<void> => {
    registerNavigation()
    phone = startPhone()
    device = Phone.makeTest()
    exit = vi.fn<() => void>()
    handle = Runtime.embed(makeDemo(phone.surface.container, { device: { platform: 'ios', osVersion: 27 }, exit }, device.layer))
    await settle()
  }

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  const streamToEnd = async (): Promise<void> => {
    await press(phone.fabric, 'markdown-speed-burst')
    await press(phone.fabric, 'markdown-stream')
    for (let turn = 0; turn < 40 && !textOf(byTestId(phone.fabric, 'markdown-stream')).startsWith('Stream it'); turn++) {
      await settle()
    }
  }

  it('says the prebuilt app is needed where the native view is missing, and streams with the fallback', async () => {
    setUp(false)
    await begin()
    expect(textOf(byTestId(phone.fabric, 'markdown-status'))).toBe(`Renderer: Foldkit fallback, because ${NEEDS_PREBUILT}`)
    expect(textOf(byTestId(phone.fabric, 'markdown-native-reason'))).toContain('Expo Go')
    expect(textOf(byTestId(phone.fabric, 'markdown-remend'))).toContain('finished by remend')
    await streamToEnd()
    expect(textOf(byTestId(phone.fabric, 'demo-reply-markdown'))).toContain('Planning a long run')
    expect(textOf(byTestId(phone.fabric, 'demo-reply-markdown'))).toContain('splitRun')
  })

  it('streams into the native view, opens links and reports copies', async () => {
    setUp(true)
    await begin()
    expect(textOf(byTestId(phone.fabric, 'markdown-status'))).toBe('Renderer: native (react-native-enriched-markdown)')
    await press(phone.fabric, 'markdown-numbers-toggle')
    await streamToEnd()
    const node = onlyNativeView(phone.fabric)
    expect(node.props['markdown']).toBe(SAMPLE_REPLY)
    phone.fabric.emit(node, 'topLinkPress', { url: 'https://foldkit.dev' })
    await settle()
    expect(device.linking.opened).toEqual(['https://foldkit.dev'])
    phone.fabric.emit(onlyNativeView(phone.fabric), 'topCopyPress', { code: 'a\nb\nc', language: 'typescript' })
    await settle()
    expect(textOf(byTestId(phone.fabric, 'markdown-last-action'))).toBe('Copied 3 lines of typescript')
    // The native view copied it itself: the program did not copy it again.
    expect(device.clipboard.calls).toEqual([])
    for (let turn = 0; turn < 20 && !textOf(byTestId(phone.fabric, 'markdown-numbers')).includes('updates sent'); turn++) {
      await settle()
    }
    expect(textOf(byTestId(phone.fabric, 'markdown-numbers'))).toMatch(/updates sent to native \d+ \(at most one a frame\)/)
  })

  it('copies through the phone’s clipboard from the fallback', async () => {
    setUp(false)
    await begin()
    await streamToEnd()
    const copy = flatten(phone.fabric.committed).find(node => String(node.props['testID']).endsWith('-copy'))
    expect(copy).toBeDefined()
    await press(phone.fabric, String(copy?.props['testID']))
    expect(device.clipboard.calls[0]).toMatch(/^copy:type Section/)
  })

  it('follows the phone into dark mode', async () => {
    setUp(true)
    await begin()
    await streamToEnd()
    const light = onlyNativeView(phone.fabric).props['markdownStyle']
    device.colorScheme.set('dark')
    await settle()
    expect(onlyNativeView(phone.fabric).props['markdownStyle']).not.toEqual(light)
  })

  it('reopens without fading again, and leaves through Exit', async () => {
    setUp(true)
    await begin()
    await streamToEnd()
    await press(phone.fabric, 'markdown-reopen')
    expect(onlyNativeView(phone.fabric).props['streamingAnimation']).toBe(false)
    expect(onlyNativeView(phone.fabric).props['markdown']).toBe(SAMPLE_REPLY)
    await press(phone.fabric, 'exit')
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
