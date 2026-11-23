import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type HotProgram,
  hasFoldkitTransport,
  hotProgram,
  keepModel,
  nativeCrash,
} from '../src/devLoop/index.js'
import { registerNavigation, text, view as box } from '../src/index.js'
import * as Counter from './counter.js'
import {
  CRASH_MESSAGE,
  type DemoEnv,
  Message,
  Model,
  init,
  makeDemo,
  makeUpdate,
  makeView,
} from './demos/devLoop.js'
import {
  type Phone,
  allText,
  byTestId,
  flatten,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

const type = async (phone: Phone, words: string, eventCount: number): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'draft'), 'topChange', { text: words, eventCount })
  await settle()
}

/** Metro's `module` for the entry file, as far as the runner uses it. */
const fakeModule = () => ({ hot: { accept: vi.fn() } })

/** The demo as it is after the developer edits the words and saves. */
const makeEditedDemo = (env: DemoEnv) => (container: HTMLElement) =>
  Runtime.makeElement(
    keepModel({
      Model,
      init,
      update: makeUpdate(env),
      view: makeView(env, 'These words were edited'),
      container,
    }),
  )

/** A program whose Model has another shape: `count` became text. */
const ReshapedModel = Schema.Struct({ count: Schema.String, isNew: Schema.Boolean })
const makeReshaped = (container: HTMLElement) =>
  Runtime.makeElement(
    keepModel({
      Model: ReshapedModel,
      init: () => ({ model: { count: 'none yet', isNew: true } }),
      update: (model: typeof ReshapedModel.Type, _message: never) => ({ model }),
      view: (model: typeof ReshapedModel.Type, h: HtmlBuilder<never>) =>
        box([h.Attribute('testID', 'reshaped')], [text([], [`count is ${model.count}`])]),
      container,
    }),
  )

/** Use the phone a little, so there is a Model worth keeping. */
const useTheDemo = async (phone: Phone): Promise<void> => {
  await press(phone.fabric, 'plus')
  await press(phone.fabric, 'plus')
  await type(phone, 'Milk', 4)
  await press(phone.fabric, 'add')
  await type(phone, 'half typed', 14)
}

const expectTheSameModel = (phone: Phone): void => {
  expect(textOf(byTestId(phone.fabric, 'count'))).toBe('2')
  expect(byTestId(phone.fabric, 'draft').props['text']).toBe('half typed')
  expect(textOf(byTestId(phone.fabric, 'item-1'))).toBe('Milk')
  expect(textOf(byTestId(phone.fabric, 'summary'))).toBe('1 items · 10 characters typed')
}

describe('the dev loop on the simulated phone', () => {
  let phone: Phone
  let program: HotProgram
  let exit: ReturnType<typeof vi.fn<() => void>>
  let env: DemoEnv

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone()
    exit = vi.fn<() => void>()
    env = { device: { platform: 'ios', osVersion: 26 }, exit }
    program = hotProgram({
      module: fakeModule(),
      make: container => makeDemo(container, env),
    })
    program.run(phone.surface)
    await settle()
  })

  afterEach(async () => {
    await program.dispose()
    await settle()
    phone.surface.dispose()
  })

  describe('the demo program', () => {
    it('tells the developer what to edit', () => {
      expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('Edit me in src/demo.ts and save')
    })

    it('counts, takes typing and adds to the list', async () => {
      await useTheDemo(phone)
      expectTheSameModel(phone)
    })

    it('leaves through env.exit', async () => {
      await press(phone.fabric, 'exit')
      expect(exit).toHaveBeenCalledTimes(1)
    })
  })

  describe('a hot update', () => {
    it('draws the new view with the old Model', async () => {
      await useTheDemo(phone)
      await program.swap(makeEditedDemo(env))
      await settle()
      expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('These words were edited')
      expectTheSameModel(phone)
    })

    it('leaves one program on screen, and it still works', async () => {
      await useTheDemo(phone)
      await program.swap(makeEditedDemo(env))
      await settle()
      expect(flatten(phone.fabric.committed).filter(node => node.props['testID'] === 'stack')).toHaveLength(1)
      await press(phone.fabric, 'plus')
      expect(textOf(byTestId(phone.fabric, 'count'))).toBe('3')
    })

    it('keeps the Model through a second save with nothing changed in between', async () => {
      await useTheDemo(phone)
      await program.swap(makeEditedDemo(env))
      await settle()
      await program.swap(container => makeDemo(container, env))
      await settle()
      expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('Edit me in src/demo.ts and save')
      expectTheSameModel(phone)
    })

    it('keeps up with two saves in a row', async () => {
      await useTheDemo(phone)
      void program.swap(makeEditedDemo(env))
      await program.swap(container => makeDemo(container, env))
      await settle()
      expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('Edit me in src/demo.ts and save')
      expectTheSameModel(phone)
    })

    it('starts fresh, without throwing, when the Model no longer fits', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await useTheDemo(phone)
      await expect(program.swap(makeReshaped)).resolves.toBeUndefined()
      await settle()
      expect(textOf(byTestId(phone.fabric, 'reshaped'))).toBe('count is none yet')
      expect(hasTestId(phone.fabric, 'stack')).toBe(false)
      warn.mockRestore()
    })

    it('gives the Model back when the misfit is undone, as Foldkit does on the web', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await useTheDemo(phone)
      await program.swap(makeReshaped)
      await settle()
      await program.swap(container => makeDemo(container, env))
      await settle()
      expectTheSameModel(phone)
      warn.mockRestore()
    })

    it('keeps the screen empty and reports it when the new code cannot start', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      await useTheDemo(phone)
      await program.swap(() => {
        throw new Error('broken on purpose')
      })
      await settle()
      expect(error).toHaveBeenCalled()
      expect(hasTestId(phone.fabric, 'stack')).toBe(false)
      // The next save has working code again, and the Model is still there.
      await program.swap(makeEditedDemo(env))
      await settle()
      expectTheSameModel(phone)
      error.mockRestore()
    })

    // Only the patched Foldkit can keep a program that was not wrapped in
    // `keepModel`: it hands every Model to the dev loop by itself.
    it.runIf(hasFoldkitTransport)(
      'keeps the Model of a program that does nothing special, through Foldkit',
      async () => {
        await program.swap(Counter.makeCounter)
        await settle()
        await press(phone.fabric, 'plus')
        await press(phone.fabric, 'plus')
        await press(phone.fabric, 'plus')
        await program.swap(container =>
          Runtime.makeElement({
            Model: Counter.Model,
            init: Counter.init,
            update: Counter.update,
            view: (model: Counter.Model, h: HtmlBuilder<Counter.Message>) =>
              box([], [text([h.Attribute('testID', 'count')], [`Count: ${model.count}`])]),
            container,
          }),
        )
        await settle()
        expect(textOf(byTestId(phone.fabric, 'count'))).toBe('Count: 3')
      },
    )
  })

  describe('the native crash screen', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('replaces the program with native views', async () => {
      await press(phone.fabric, 'crash')
      expect(hasTestId(phone.fabric, 'stack')).toBe(false)
      const crashScreen = byTestId(phone.fabric, 'crash-screen')
      expect(crashScreen.viewName).toBe('View')
      expect(byTestId(phone.fabric, 'crash-title').viewName).toBe('Paragraph')
      // Nothing from Foldkit's HTML crash view reached the phone.
      const drawn = flatten([crashScreen]).map(node => node.viewName)
      expect(new Set(drawn)).toEqual(new Set(['View', 'Paragraph', 'RawText', 'ScrollView']))
    })

    it('shows a red title, the error and how to reload', async () => {
      await press(phone.fabric, 'crash')
      expect(textOf(byTestId(phone.fabric, 'crash-title'))).toBe('The program crashed')
      expect(byTestId(phone.fabric, 'crash-title').props['color']).toBeDefined()
      expect(textOf(byTestId(phone.fabric, 'crash-message'))).toBe(CRASH_MESSAGE)
      expect(textOf(byTestId(phone.fabric, 'crash-during'))).toBe('While handling PressedCrash')
      expect(textOf(byTestId(phone.fabric, 'crash-hint'))).toContain('Reload')
    })

    it('takes its hint from the program', async () => {
      await program.swap(container =>
        Runtime.makeElement({
          Model,
          init,
          update: makeUpdate(env),
          view: makeView(env),
          container,
          crash: nativeCrash<Model, Message>({ hint: 'Ask Robin.' }),
        }),
      )
      await settle()
      await press(phone.fabric, 'crash')
      expect(allText(phone.fabric)).toContain('Ask Robin.')
    })

    it('comes back from a crash on the next hot update, with the Model', async () => {
      await useTheDemo(phone)
      await press(phone.fabric, 'crash')
      expect(hasTestId(phone.fabric, 'crash-screen')).toBe(true)
      await program.swap(makeEditedDemo(env))
      await settle()
      expect(hasTestId(phone.fabric, 'crash-screen')).toBe(false)
      expectTheSameModel(phone)
    })
  })
})

describe('the dev loop with Metro', () => {
  const env: DemoEnv = { device: { platform: 'ios', osVersion: 26 }, exit: () => {} }
  let phone: Phone
  let program: HotProgram

  beforeEach(() => {
    registerNavigation()
    phone = startPhone()
  })

  afterEach(async () => {
    await program.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('swaps when the entry file runs again, as it does after a save', async () => {
    // Metro keeps one `module` object per file across hot updates.
    const entryModule = fakeModule()
    program = hotProgram({ module: entryModule, make: container => makeDemo(container, env) })
    program.run(phone.surface)
    await settle()
    await useTheDemo(phone)

    // The save: Metro runs the entry file again, top to bottom. The phone
    // does not start the app again, so nobody calls `run`.
    const again = hotProgram({ module: entryModule, make: makeEditedDemo(env) })
    await again.swap(makeEditedDemo(env))
    await settle()

    expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('These words were edited')
    expectTheSameModel(phone)
    // Each run of the entry file told Metro to stop there, not reload the app.
    expect(entryModule.hot.accept).toHaveBeenCalledTimes(2)
  })

  it('only starts the program when there is no Metro (a release build)', async () => {
    program = hotProgram({ make: container => makeDemo(container, env) })
    program.run(phone.surface)
    await settle()
    await press(phone.fabric, 'plus')
    expect(textOf(byTestId(phone.fabric, 'count'))).toBe('1')

    // A second call is a second program, not a hot update of the first.
    const other = hotProgram({ make: makeEditedDemo(env) })
    await settle()
    expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('Edit me in src/demo.ts and save')
    await other.dispose()
  })
})

// Metro's own module system, the file that decides on the phone whether a
// save becomes a hot update or a full reload. It is only there once an app
// has been installed (`npm install` in apps/devloop), or point METRO_REQUIRE
// at any copy of metro-runtime/src/polyfills/require.js.
const metroRequirePath =
  process.env['METRO_REQUIRE'] ??
  fileURLToPath(
    new URL(
      '../../../apps/devloop/node_modules/metro-runtime/src/polyfills/require.js',
      import.meta.url,
    ),
  )

type MetroModule = { exports: Record<string, unknown>; hot?: { accept: () => void } }
type MetroFactory = (
  global: unknown,
  require: (id: number) => Record<string, any>,
  importDefault: unknown,
  importAll: unknown,
  module: MetroModule,
  exports: Record<string, unknown>,
  dependencyMap: ReadonlyArray<number>,
) => void
type Metro = {
  __d: (
    factory: MetroFactory,
    id: number,
    dependencyMap: ReadonlyArray<number>,
    name: string,
    inverseDependencies?: Record<number, ReadonlyArray<number>>,
  ) => void
  __r: (id: number) => unknown
}

/** A development bundle's module system, as Metro starts it on the phone. */
const startMetro = (): Metro => {
  const metro = {} as Metro
  new Function('global', '__DEV__', '__METRO_GLOBAL_PREFIX__', readFileSync(metroRequirePath, 'utf8'))(
    metro,
    true,
    '',
  )
  return metro
}

describe.runIf(existsSync(metroRequirePath))("the dev loop inside Metro's own module system", () => {
  const env: DemoEnv = { device: { platform: 'ios', osVersion: 26 }, exit: () => {} }
  const DEMO = 1
  const ENTRY = 0
  let phone: Phone
  let programs: Array<HotProgram>
  let entryRuns: number
  let warn: ReturnType<typeof vi.spyOn>

  /** `src/demo.ts`, with the words it had when it was saved. */
  const demoFile =
    (words: string): MetroFactory =>
    (_global, _require, _importDefault, _importAll, _module, exports) => {
      exports['makeDemo'] = (container: HTMLElement) =>
        Runtime.makeElement(
          keepModel({ Model, init, update: makeUpdate(env), view: makeView(env, words), container }),
        )
    }

  /** `index.ts`. `passModule` is whether it hands `module` to `hotProgram`. */
  const entryFile =
    (passModule: boolean): MetroFactory =>
    (_global, require, _importDefault, _importAll, module, _exports, dependencyMap) => {
      const demo = require(dependencyMap[0] as number)
      const isFirstRun = entryRuns === 0
      entryRuns++
      const program = hotProgram({
        ...(passModule ? { module } : {}),
        make: container => demo['makeDemo'](container),
      })
      programs.push(program)
      // The phone starts the app once. A hot update does not start it again.
      if (isFirstRun) program.run(phone.surface)
    }

  /** A save of `src/demo.ts`, as Metro's hot update client delivers it. */
  const saveDemo = async (metro: Metro, words: string): Promise<void> => {
    metro.__d(demoFile(words), DEMO, [], 'src/demo.ts', { [DEMO]: [ENTRY], [ENTRY]: [] })
    await settle()
    await settle()
  }

  beforeEach(() => {
    registerNavigation()
    phone = startPhone()
    programs = []
    entryRuns = 0
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    for (const program of programs) await program.dispose()
    await settle()
    phone.surface.dispose()
    warn.mockRestore()
  })

  it('takes a save as a hot update and keeps the Model, save after save', async () => {
    const metro = startMetro()
    metro.__d(demoFile('First words'), DEMO, [], 'src/demo.ts')
    metro.__d(entryFile(true), ENTRY, [DEMO], 'index.ts')
    metro.__r(ENTRY)
    await settle()
    await useTheDemo(phone)

    await saveDemo(metro, 'Second words')
    expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('Second words')
    expectTheSameModel(phone)

    // The second save only works if the entry file accepted again when it
    // ran the second time.
    await saveDemo(metro, 'Third words')
    expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('Third words')
    expectTheSameModel(phone)

    expect(entryRuns).toBe(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('shows what the runner prevents: with no `module`, Metro asks for a full reload', async () => {
    const metro = startMetro()
    metro.__d(demoFile('First words'), DEMO, [], 'src/demo.ts')
    metro.__d(entryFile(false), ENTRY, [DEMO], 'index.ts')
    metro.__r(ENTRY)
    await settle()

    await saveDemo(metro, 'Second words')
    // No app to reload here, so Metro says it could not. On a phone this is
    // the full reload that loses the Model.
    expect(warn).toHaveBeenCalledWith('Could not reload the application after an edit.')
    expect(entryRuns).toBe(1)
    expect(textOf(byTestId(phone.fabric, 'edit-me'))).toBe('First words')
  })
})
