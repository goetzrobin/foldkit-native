/**
 * Server state on the simulated phone.
 *
 * The first part drives the demo as a person would and reads the screen and
 * the pretend server's log. Time is controlled twice over. How long a request
 * takes is Effect's `TestClock`: nothing answers until a test says
 * `advance(600)`. How old data is uses the wall clock, as Effect's atoms do,
 * so the tests move `Date` by hand with `passTime`.
 *
 * The second part tests the pieces in `src/serverState` on their own.
 */
import { Clock, Effect, Exit, Layer, Option, Scope, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as Reactivity from 'effect/reactivity/Reactivity'
import * as TestClock from 'effect/testing/TestClock'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as Device from '../src/device/index.js'
import { registerNavigation } from '../src/index.js'
import { Optimistic, makeSync } from '../src/serverState/index.js'
import { Model, makeServerStateDemo } from './demos/serverState.js'
import { type CrewServer, MemberKey, makeCrewServer } from './demos/serverStateCrew.js'
import {
  type Phone,
  byTestId,
  flatten,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

type Demo = ReturnType<typeof makeServerStateDemo>

const STARTED_AT = new Date('2026-11-24T09:00:00Z').getTime()

describe('the server state demo on the simulated phone', () => {
  let phone: Phone
  let device: ReturnType<typeof Device.makeTest>
  let api: CrewServer
  let demo: Demo
  let handle: { dispose: () => void } | undefined
  let clock: TestClock.TestClock
  let clockScope: Scope.Closeable
  let exits = 0

  const shown = (id: string): string => textOf(byTestId(phone.fabric, id))

  /** Lets requests that are waiting on the server's latency finish. */
  const advance = async (ms: number): Promise<void> => {
    await Effect.runPromise(clock.adjust(ms))
    await settle()
  }

  /** Makes loaded data older, without anything else happening. */
  const passTime = async (seconds: number): Promise<void> => {
    vi.setSystemTime(Date.now() + seconds * 1000)
    await settle()
  }

  const type = async (id: string, value: string): Promise<void> => {
    phone.fabric.emit(byTestId(phone.fabric, id), 'topChange', {
      text: value,
      eventCount: value.length,
    })
    await settle()
  }

  const leaveAndComeBack = async (): Promise<void> => {
    device.appState.set('background')
    await settle()
    device.appState.set('active')
    await settle()
  }

  const requestsFor = (line: string): number => api.log().filter(each => each === line).length

  const rowViews = (): number =>
    flatten([byTestId(phone.fabric, 'roster-list')]).filter(node =>
      /^member-\d+$/.test(String(node.props['testID'] ?? '')),
    ).length

  const start = async (
    options: Readonly<{ idleTtl?: string }> = {},
  ): Promise<void> => {
    api = makeCrewServer()
    demo = makeServerStateDemo(
      phone.surface.container,
      {
        device: { platform: 'ios', osVersion: 26 },
        exit: () => {
          exits += 1
        },
      },
      device.layer,
      {
        api,
        extra: Layer.succeed(Clock.Clock, clock),
        tickMs: 30,
        ...(options.idleTtl === undefined ? {} : { idleTtl: options.idleTtl }),
      },
    )
    handle = Runtime.embed(demo.program)
    await settle()
  }

  const stop = async (): Promise<void> => {
    handle?.dispose()
    handle = undefined
    await settle()
  }

  /** Opens a member and lets its request, if any, finish. */
  const open = async (id: number): Promise<void> => {
    await press(phone.fabric, `member-${id}`)
    await advance(600)
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(STARTED_AT)
    exits = 0
    registerNavigation()
    phone = startPhone()
    device = Device.makeTest()
    clockScope = Effect.runSync(Scope.make())
    clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(clockScope)))
  })

  afterEach(async () => {
    await stop()
    phone.surface.dispose()
    await Effect.runPromise(Scope.close(clockScope, Exit.void))
    vi.useRealTimers()
  })

  describe('loading', () => {
    it('says loading, then fresh, and counts one request', async () => {
      await start()
      expect(shown('roster-list-status')).toBe('loading')
      expect(shown('roster-requests')).toBe('1 request received')
      expect(api.log()).toEqual(['GET /crew'])

      await advance(600)
      expect(shown('roster-list-status')).toBe('fresh, 0 s old, 200 members')
      expect(shown('roster-requests')).toBe('1 request received')
      expect(shown('roster-log')).toContain('GET /crew')
      expect(shown('roster-log')).toContain('list loaded')
    })

    it('does not answer before the latency has passed', async () => {
      await start()
      await advance(599)
      expect(shown('roster-list-status')).toBe('loading')
      await advance(1)
      expect(shown('roster-list-status')).toContain('fresh')
    })

    it('counts the age of what is on screen and calls it stale in time', async () => {
      await start()
      await advance(600)
      await passTime(12)
      expect(shown('roster-list-status')).toBe('fresh, 12 s old, 200 members')
      await passTime(18)
      expect(shown('roster-list-status')).toBe('stale, 30 s old, 200 members')
      // Getting old does not load anything by itself.
      expect(api.requests()).toBe(1)
    })
  })

  describe('a large list', () => {
    it('draws rows from the cache while the Model holds only a status and a count', async () => {
      await start()
      await advance(600)
      expect(textOf(byTestId(phone.fabric, 'member-1-name'))).toBe('Ada Marlow')
      // 200 members are loaded and only the rows near the screen are views.
      expect(rowViews()).toBeGreaterThan(3)
      expect(rowViews()).toBeLessThan(60)
      expect(hasTestId(phone.fabric, 'member-200')).toBe(false)
      // The Model keeps a summary of the roster and nothing that holds members.
      expect(Object.keys(Model.fields.roster.fields)).toEqual([
        'phase',
        'isWaiting',
        'count',
        'fetchedAt',
        'error',
      ])
      // The members are in the cache, where the view reads them.
      const cached = demo.server.peek(demo.crew.roster(30))
      expect(
        Option.isSome(cached) && AsyncResult.isSuccess(cached.value) && cached.value.value.length,
      ).toBe(200)
    })

    it('redraws a row when the cache changes, though the Model holds no rows', async () => {
      await start()
      await advance(600)
      api.renameElsewhere(1)
      await passTime(31)
      await leaveAndComeBack()
      await advance(600)
      expect(textOf(byTestId(phone.fabric, 'member-1-name'))).toBe('Renamed elsewhere 1')
    })
  })

  describe('the cache and the family key', () => {
    it('opens the same member twice for one request', async () => {
      await start()
      await advance(600)

      await press(phone.fabric, 'member-3')
      expect(shown('member-name')).toBe('Loading…')
      await advance(600)
      expect(shown('member-name')).toBe('Cleo Marlow')
      expect(requestsFor('GET /crew/3')).toBe(1)

      await press(phone.fabric, 'back')
      expect(hasTestId(phone.fabric, 'screen-member')).toBe(false)

      // No time is given to the server: the name can only come from the cache.
      await press(phone.fabric, 'member-3')
      expect(shown('member-name')).toBe('Cleo Marlow')
      expect(shown('member-member-status')).toBe('fresh, 0 s old')
      expect(shown('member-log')).toContain('member 3 shown from the cache')
      expect(requestsFor('GET /crew/3')).toBe(1)
      expect(api.requests()).toBe(2)
    })

    it('loads a different member with its own request', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'back')
      await open(4)
      expect(shown('member-name')).toBe('Dov Marlow')
      expect(requestsFor('GET /crew/3')).toBe(1)
      expect(requestsFor('GET /crew/4')).toBe(1)
    })
  })

  describe('two screens, one request', () => {
    it('shares the roster between the list and the member screen', async () => {
      await start()
      await advance(600)
      // A refresh of the roster is on its way when the member screen opens.
      await passTime(31)
      await leaveAndComeBack()
      expect(requestsFor('GET /crew')).toBe(2)
      await press(phone.fabric, 'member-1')
      expect(demo.server.watcherCount(demo.crew.roster(30))).toBe(2)
      expect(shown('member-watching')).toBe('list ×2, member 1 ×1')

      await advance(600)
      // The second watcher joined the request already running.
      expect(requestsFor('GET /crew')).toBe(2)
      expect(shown('member-detail')).toContain('One of 200 crew.')
      expect(shown('member-list-status')).toBe('fresh, 0 s old, 200 members')
    })

    it('refetches the roster once when a topic is announced, however many watch it', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'add-note')
      await advance(600) // the POST
      await advance(600) // the two reads it set off
      expect(requestsFor('GET /crew')).toBe(2)
      expect(requestsFor('GET /crew/3')).toBe(2)
    })
  })

  describe('sync keys', () => {
    it('updates the list behind the member screen after an edit, with no wiring between them', async () => {
      await start()
      await advance(600)
      await open(3)
      await type('name-field', 'Cleo the Bold')
      await press(phone.fabric, 'save')
      await advance(600) // the PUT

      expect(shown('member-log')).toContain('topic crew:member-changed announced')
      expect(api.log().slice(-3)).toEqual(['PUT /crew/3', 'GET /crew', 'GET /crew/3'])
      expect(shown('member-list-status')).toContain('refreshing')

      await advance(600) // both reads
      expect(textOf(byTestId(phone.fabric, 'member-3-name'))).toBe('Cleo the Bold')
      expect(shown('member-name')).toBe('Cleo the Bold')
      expect(shown('member-log')).toContain('list refetched')
      expect(shown('save-status')).toBe('Saved')
    })

    it('leaves the list wrong when the write does not announce its topic', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'member-announce')
      expect(shown('member-announce')).toBe('Announce topic: off')
      await type('name-field', 'Cleo the Bold')
      await press(phone.fabric, 'save')
      await advance(600)
      await advance(600)

      expect(api.peek(3)?.name).toBe('Cleo the Bold')
      expect(api.log()).toEqual(['GET /crew', 'GET /crew/3', 'PUT /crew/3'])
      // The server has the new name and the list still shows the old one.
      expect(textOf(byTestId(phone.fabric, 'member-3-name'))).toBe('Cleo Marlow')
    })

    it('shows the old name on the member screen too, with no topic and no optimistic layer', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'member-announce')
      await press(phone.fabric, 'member-optimistic')
      await type('name-field', 'Cleo the Bold')
      await press(phone.fabric, 'save')
      await advance(600)
      expect(shown('save-status')).toBe('Saved')
      expect(shown('member-name')).toBe('Cleo Marlow')
    })

    it('runs a plain Effect write through the same services and announces its topic', async () => {
      await start()
      await advance(600)
      await open(3)
      expect(shown('member-detail')).toContain('2 notes')
      await press(phone.fabric, 'add-note')
      expect(shown('note-status')).toBe('Adding a note…')
      await advance(600)
      expect(shown('note-status')).toBe('Note added')
      expect(shown('member-log')).toContain('topic crew:note-added announced')
      await advance(600)
      expect(shown('member-detail')).toContain('3 notes')
    })

    it('reloads a member that was closed when a topic was announced', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'back')
      // Member 3 is in the cache and nobody watches it. A write elsewhere
      // announces the topic member 3 listens for.
      await open(4)
      await press(phone.fabric, 'add-note')
      await advance(600)
      await advance(600)
      await press(phone.fabric, 'back')
      expect(requestsFor('GET /crew/3')).toBe(1)

      // Still well inside the 30 seconds, and it is loaded again all the same.
      await press(phone.fabric, 'member-3')
      expect(shown('member-name')).toBe('Cleo Marlow')
      expect(shown('member-member-status')).toContain('refreshing')
      expect(requestsFor('GET /crew/3')).toBe(2)
    })
  })

  describe('stale data', () => {
    it('shows what it has at once and refreshes behind it', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'back')
      api.renameElsewhere(3)
      await passTime(31)

      await press(phone.fabric, 'member-3')
      // The old name is on screen before the server has answered.
      expect(shown('member-name')).toBe('Cleo Marlow')
      expect(shown('member-member-status')).toBe('refreshing, 31 s old')
      expect(requestsFor('GET /crew/3')).toBe(2)

      await advance(600)
      expect(shown('member-name')).toBe('Renamed elsewhere 1')
      expect(shown('member-member-status')).toBe('fresh, 0 s old')
      expect(shown('member-log')).toContain('member 3 refetched')
    })

    it('does not reload data that is still fresh', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'back')
      await passTime(29)
      await press(phone.fabric, 'member-3')
      expect(shown('member-member-status')).toBe('fresh, 29 s old')
      expect(requestsFor('GET /crew/3')).toBe(1)
    })

    it('goes stale sooner when "Stale after" is 5 s, and keeps what was loaded', async () => {
      await start()
      await advance(600)
      await press(phone.fabric, 'roster-stale')
      expect(shown('roster-stale')).toBe('Stale after: 5 s')
      // The same loaded roster under a new rule: nothing is fetched again.
      expect(shown('roster-list-status')).toBe('fresh, 0 s old, 200 members')
      expect(api.requests()).toBe(1)
      await passTime(6)
      expect(shown('roster-list-status')).toBe('stale, 6 s old, 200 members')
    })
  })

  describe('coming back to the app', () => {
    it('reloads stale data and leaves fresh data alone', async () => {
      await start()
      await advance(600)

      await passTime(10)
      await leaveAndComeBack()
      expect(requestsFor('GET /crew')).toBe(1)

      await passTime(21)
      await leaveAndComeBack()
      expect(requestsFor('GET /crew')).toBe(2)
      expect(shown('roster-list-status')).toBe('refreshing, 31 s old, 200 members')
      expect(shown('roster-log')).toContain('came back to the app')
      await advance(600)
      expect(shown('roster-list-status')).toBe('fresh, 0 s old, 200 members')
    })

    it('is the only way this phone learns of an edit made on another device', async () => {
      await start()
      await advance(600)
      await press(phone.fabric, 'roster-remote-edit')
      await advance(5000)
      expect(api.peek(1)?.name).toBe('Renamed elsewhere 1')
      // No request was made and no topic was announced, so the list is old.
      expect(api.requests()).toBe(1)
      expect(textOf(byTestId(phone.fabric, 'member-1-name'))).toBe('Ada Marlow')
      expect(shown('roster-log')).toContain('another device renamed member 1')

      await passTime(31)
      await leaveAndComeBack()
      await advance(600)
      expect(textOf(byTestId(phone.fabric, 'member-1-name'))).toBe('Renamed elsewhere 1')
    })
  })

  describe('failures', () => {
    it('rolls an optimistic rename back when the write fails, and says so', async () => {
      await start()
      await advance(600)
      await open(3)
      await type('name-field', 'Cleo the Bold')
      await press(phone.fabric, 'member-fail-next')
      expect(shown('member-fail-next')).toBe('Next request will fail')
      await press(phone.fabric, 'save')

      // Optimistic: the new name is shown while the request is on its way.
      expect(shown('member-name')).toBe('Cleo the Bold')
      expect(shown('save-status')).toBe('Saving…')

      await advance(600)
      expect(shown('member-name')).toBe('Cleo Marlow')
      expect(shown('save-status')).toBe(
        'Could not save: the server said no (500). The old name was put back.',
      )
      expect(shown('member-fail-next')).toBe('Fail next request')
      expect(api.peek(3)?.name).toBe('Cleo Marlow')
      // A failed write announces nothing, so nothing is loaded again.
      expect(api.log().slice(-2)).toEqual(['PUT /crew/3', 'PUT /crew/3 failed'])
    })

    it('waits for the server before showing the name when Optimistic is off', async () => {
      await start()
      await advance(600)
      await open(3)
      await press(phone.fabric, 'member-optimistic')
      await type('name-field', 'Cleo the Bold')
      await press(phone.fabric, 'save')
      expect(shown('member-name')).toBe('Cleo Marlow')
      await advance(600)
      await advance(600)
      expect(shown('member-name')).toBe('Cleo the Bold')
    })

    it('keeps the last good list when a refresh fails, and loads again on Retry', async () => {
      await start()
      await advance(600)
      await passTime(31)
      await press(phone.fabric, 'roster-fail-next')
      await leaveAndComeBack()
      await advance(600)

      expect(shown('roster-list-status')).toBe('failed, 31 s old, 200 members')
      expect(shown('roster-error')).toBe(
        'Could not refresh: the server said no (500). This is the last good list.',
      )
      expect(textOf(byTestId(phone.fabric, 'member-1-name'))).toBe('Ada Marlow')
      expect(rowViews()).toBeGreaterThan(3)

      await press(phone.fabric, 'retry-roster')
      expect(shown('roster-list-status')).toContain('refreshing')
      await advance(600)
      expect(shown('roster-list-status')).toBe('fresh, 0 s old, 200 members')
      expect(hasTestId(phone.fabric, 'roster-error')).toBe(false)
    })

    it('says so when a first load fails, and loads on Retry', async () => {
      await start()
      await advance(600)
      await press(phone.fabric, 'roster-fail-next')
      await open(7)
      expect(shown('member-member-status')).toBe('failed')
      expect(shown('member-error')).toBe(
        'Could not load this member: the server said no (500).',
      )
      await press(phone.fabric, 'retry-member')
      await advance(600)
      expect(shown('member-name')).toBe('Greta Marlow')
      expect(hasTestId(phone.fabric, 'member-error')).toBe(false)
    })
  })

  describe('leaving a screen', () => {
    it('stops the member Subscription and the member screen\'s roster Subscription', async () => {
      await start()
      await advance(600)
      const member = demo.crew.member(new MemberKey({ id: 3, staleSeconds: 30 }))
      const roster = demo.crew.roster(30)
      await open(3)
      expect(demo.server.watcherCount(member)).toBe(1)
      expect(demo.server.watcherCount(roster)).toBe(2)

      await press(phone.fabric, 'back')
      expect(demo.server.watcherCount(member)).toBe(0)
      expect(demo.server.watcherCount(roster)).toBe(1)
      expect(shown('roster-watching')).toBe('list ×1')
      expect(shown('roster-log')).toContain('left member 3: stopped watching it')
    })

    it('stops them on a swipe back as well', async () => {
      await start()
      await advance(600)
      await open(3)
      phone.fabric.emit(byTestId(phone.fabric, 'screen-member'), 'topDismissed', {
        dismissCount: 1,
      })
      await settle()
      expect(
        demo.server.watcherCount(demo.crew.member(new MemberKey({ id: 3, staleSeconds: 30 }))),
      ).toBe(0)
      expect(hasTestId(phone.fabric, 'screen-member')).toBe(false)
    })

    it('ignores an answer that arrives for a member that is no longer open', async () => {
      await start()
      await advance(600)
      await press(phone.fabric, 'member-3')
      await press(phone.fabric, 'back')
      await press(phone.fabric, 'member-4')
      await advance(600)
      expect(shown('member-name')).toBe('Dov Marlow')
    })

    it('drops a closed member from the cache after its idle time', async () => {
      await start({ idleTtl: '100 millis' })
      await advance(600)
      const member = demo.crew.member(new MemberKey({ id: 3, staleSeconds: 30 }))
      await open(3)
      await press(phone.fabric, 'back')
      // Kept for now, then dropped.
      await new Promise(resolve => setTimeout(resolve, 500))
      expect(Option.isNone(demo.server.peek(member))).toBe(true)

      await press(phone.fabric, 'member-3')
      expect(shown('member-name')).toBe('Loading…')
      expect(requestsFor('GET /crew/3')).toBe(2)
    })
  })

  describe('the controls', () => {
    it('cycles the latency and the server takes that long', async () => {
      await start()
      await advance(600)
      await press(phone.fabric, 'roster-latency')
      expect(shown('roster-latency')).toBe('Latency: 2000 ms')
      expect(api.latencyMs()).toBe(2000)
      await press(phone.fabric, 'member-3')
      await advance(1999)
      expect(shown('member-name')).toBe('Loading…')
      await advance(1)
      expect(shown('member-name')).toBe('Cleo Marlow')
      await press(phone.fabric, 'member-latency')
      expect(shown('member-latency')).toBe('Latency: 100 ms')
      await press(phone.fabric, 'member-latency')
      expect(shown('member-latency')).toBe('Latency: 600 ms')
    })

    it('leaves through Menu', async () => {
      await start()
      await press(phone.fabric, 'menu')
      expect(exits).toBe(1)
    })
  })

  describe('the end of the program', () => {
    it('disposes the registry, stops every Subscription and makes no more requests', async () => {
      await start()
      await advance(600)
      await open(3)
      expect(demo.server.isRunning()).toBe(true)
      expect(device.appState.listenerCount()).toBe(1)
      const roster = demo.crew.roster(30)

      await stop()
      expect(demo.server.isRunning()).toBe(false)
      expect(demo.server.watcherCount(roster)).toBe(0)
      expect(Option.isNone(demo.server.peek(roster))).toBe(true)
      expect(device.appState.listenerCount()).toBe(0)

      const before = api.requests()
      await passTime(60)
      device.appState.set('background')
      device.appState.set('active')
      await advance(5000)
      expect(api.requests()).toBe(before)
    })

    it('cuts short a request that is on its way', async () => {
      await start()
      expect(api.log()).toEqual(['GET /crew'])
      await stop()
      await advance(600)
      // The request was interrupted with the registry, so it was never answered.
      expect(api.answered()).toBe(0)
      expect(demo.server.isRunning()).toBe(false)
    })
  })
})

describe('sync topics', () => {
  const Bus = makeSync(['crew:member-changed', 'crew:note-added'])
  const layer = Layer.provide(Bus.layer, Reactivity.layer)

  it('refuses a topic that is not in the list, loudly, everywhere', async () => {
    const unknown = 'crew:member-chagned' as never

    expect(() => Bus.reactivityKey(unknown)).toThrow(/unknown topic "crew:member-chagned"/)
    expect(() => Bus.refreshOn(unknown)).toThrow(/unknown topic/)

    const announced = await Effect.runPromiseExit(Effect.provide(Bus.invalidate(unknown), layer))
    expect(Exit.isFailure(announced) && Exit.hasDies(announced)).toBe(true)

    const heard = await Effect.runPromiseExit(
      Effect.provide(Stream.runDrain(Stream.take(Bus.listen(unknown), 1)), layer),
    )
    expect(Exit.isFailure(heard) && Exit.hasDies(heard)).toBe(true)
  })

  it('delivers an announcement to a listener of that topic and to no other', async () => {
    const heard = await Effect.runPromise(
      Effect.gen(function* () {
        const lines: Array<string> = []
        const listen = (topic: (typeof Bus.topics)[number]) =>
          Effect.forkScoped(
            Stream.runForEach(Bus.listen(topic), () => Effect.sync(() => lines.push(topic))),
          )
        yield* listen('crew:member-changed')
        yield* listen('crew:note-added')
        yield* Effect.yieldNow
        yield* Effect.sleep(10)
        yield* Bus.invalidate('crew:note-added')
        yield* Bus.invalidate('crew:note-added')
        yield* Effect.sleep(10)
        return lines
      }).pipe(Effect.scoped, Effect.provide(layer)),
    )
    expect(heard).toEqual(['crew:note-added', 'crew:note-added'])
  })

  it('gives each topic its own key', () => {
    expect(Bus.reactivityKey('crew:member-changed')).not.toBe(Bus.reactivityKey('crew:note-added'))
  })
})

describe('the optimistic layer', () => {
  const apply = (value: { name: string }, patch: { name: string }) => ({ ...value, ...patch })
  const server = { name: 'Old' }

  it('shows the patch from the moment the write begins', () => {
    const overlay = Optimistic.begin(1, { name: 'New' })
    expect(Optimistic.shown(overlay, server, apply)).toEqual({ name: 'New' })
    expect(Optimistic.isPending(overlay)).toBe(true)
    expect(Optimistic.shown(Optimistic.none<{ name: string }>(), server, apply)).toEqual(server)
  })

  it('takes the patch off when the write fails', () => {
    const overlay = Optimistic.rollBack(Optimistic.begin(1, { name: 'New' }), 1)
    expect(Optimistic.shown(overlay, server, apply)).toEqual({ name: 'Old' })
  })

  it('keeps a confirmed patch until a finished load arrives', () => {
    const confirmed = Optimistic.confirm(Optimistic.begin(1, { name: 'New' }), 1)
    expect(Optimistic.isPending(confirmed)).toBe(false)
    const refreshing = AsyncResult.success({ name: 'Old' }, { waiting: true })
    expect(Option.isSome(Optimistic.settle(confirmed, refreshing))).toBe(true)
    const loaded = AsyncResult.success({ name: 'New' })
    expect(Option.isNone(Optimistic.settle(confirmed, loaded))).toBe(true)
  })

  it('does not drop a patch whose write has not been confirmed', () => {
    const sending = Optimistic.begin(1, { name: 'New' })
    expect(Option.isSome(Optimistic.settle(sending, AsyncResult.success({ name: 'Old' })))).toBe(
      true,
    )
  })

  it('does not let the answer to an older write touch a newer one', () => {
    const second = Optimistic.begin(2, { name: 'Second' })
    expect(Optimistic.rollBack(second, 1)).toBe(second)
    expect(Optimistic.confirm(second, 1)).toBe(second)
  })
})

describe('atoms', () => {
  it('are plain values: making one starts nothing', () => {
    // Guards the demo's claim that atoms can be defined before a program runs.
    const atom = Atom.make(0)
    expect(Atom.isAtom(atom)).toBe(true)
  })
})
