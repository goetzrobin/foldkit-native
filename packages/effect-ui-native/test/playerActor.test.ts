/**
 * The player as a running actor, with no screen: the service, the pretend
 * phone's audio behind it, the shared clock, and the actor's own record.
 */
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { SharedClock, makeClock } from '../chat/clock.js'
import { PlayerEvent as E, type PlayerStep } from '../chat/machines/player.js'
import { Player } from '../chat/machines/playerActor.js'
import { Phone } from '../src/index.js'
import { provideForTest, run } from './support.js'

const a = { uri: 'file:///a.m4a', label: 'Voice note 0:03' }
const b = { uri: 'file:///b.m4a', label: 'Voice note 0:07' }
const row = (id: string) => ({ name: 'voice-row', id })
const bar = (id: string) => ({ name: 'mini-bar', id })

/** Long enough for the pretend phone to answer a play. */
const tick = Effect.sleep('15 millis')

const setup = () =>
  Effect.gen(function* () {
    const device = Phone.Device.makeTest()
    const clock = makeClock()
    const layer = Player.Live.pipe(Layer.provide(Layer.merge(device.layer, Layer.succeed(SharedClock, clock))))
    const player = yield* Effect.service(Player).pipe(provideForTest(layer))
    const heard: Array<PlayerStep> = []
    player.listen(step => heard.push(step))
    return { device, clock, player, heard }
  })

const tags = (steps: ReadonlyArray<PlayerStep>) =>
  steps.map(step => `${step.seq} ${step.before._tag} + ${step.event._tag} by ${step.event.by.name} = ${step.after._tag}`)

describe('The player actor', () => {
  it('plays a note: the phone is asked, and each step tells the whole story', () =>
    run(
      Effect.gen(function* () {
        const { device, player, heard } = yield* setup()
        expect(player.state()._tag).toBe('Stopped')
        expect(player.latest()).toBeNull()
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        expect(device.audio.players.map(each => each.uri)).toEqual([a.uri])
        expect(device.audio.players[0]?.isPlaying).toBe(true)
        expect(tags(heard)).toEqual([
          '1 Stopped + Play by voice-row = Loading',
          // 2 is the phone's first report of where the sound is. It came while loading, and was ignored.
          '3 Loading + AudioReady by audio = Playing',
        ])
        // The step carries the states themselves, the event with its sender, and the number.
        expect(heard[0]).toMatchObject({
          seq: 1,
          before: { _tag: 'Stopped' },
          event: { _tag: 'Play', note: a, by: { name: 'voice-row', id: 'r1' } },
          after: { _tag: 'Loading', note: a },
          changed: true,
        })
        expect(player.latest()).toBe(heard[1])
        expect(player.state()).toMatchObject({ _tag: 'Playing', note: a, positionMs: 0 })
      }),
    ))

  it('pause and resume reach the phone, and the place in the note is kept', () =>
    run(
      Effect.gen(function* () {
        const { device, player } = yield* setup()
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        device.audio.advance(1000)
        yield* tick
        expect(player.state()).toMatchObject({ _tag: 'Playing', positionMs: 1000 })
        yield* player.send(E.Pause({ by: bar('b1') }))
        expect(player.state()).toMatchObject({ _tag: 'Paused', note: a, positionMs: 1000 })
        expect(device.audio.players[0]?.isPlaying).toBe(false)
        yield* player.send(E.Resume({ by: bar('b2') }))
        yield* tick
        expect(player.state()).toMatchObject({ _tag: 'Playing', note: a, positionMs: 1000 })
        expect(device.audio.players[0]?.isPlaying).toBe(true)
        // Still the first native player: resume did not load the note again.
        expect(device.audio.players.length).toBe(1)
      }),
    ))

  it('a second note stops the first', () =>
    run(
      Effect.gen(function* () {
        const { device, player } = yield* setup()
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        yield* player.send(E.Play({ note: b, by: row('r2') }))
        yield* tick
        const [first, second] = device.audio.players
        expect(first?.isReleased).toBe(true)
        expect(first?.isPlaying).toBe(false)
        expect(second?.uri).toBe(b.uri)
        expect(second?.isPlaying).toBe(true)
        expect(player.state()).toMatchObject({ _tag: 'Playing', note: b })
      }),
    ))

  it('a note that reaches its end stops the player and frees the phone', () =>
    run(
      Effect.gen(function* () {
        const { device, player, heard } = yield* setup()
        device.audio.durations.set(a.uri, 2)
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        device.audio.advance(2500)
        yield* tick
        expect(player.state()._tag).toBe('Stopped')
        expect(heard.at(-1)).toMatchObject({ event: { _tag: 'Finished', uri: a.uri, by: { name: 'audio' } }, after: { _tag: 'Stopped' } })
        expect(device.audio.players[0]?.isReleased).toBe(true)
      }),
    ))

  it('a note the phone cannot play ends in Failed, with the reason', () =>
    run(
      Effect.gen(function* () {
        const { device, player } = yield* setup()
        device.audio.state.failNext = { method: 'play', reason: 'The file is gone.' }
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        expect(player.state()).toMatchObject({ _tag: 'Failed', note: a, reason: 'The file is gone.' })
        yield* player.send(E.Stop({ by: bar('b1') }))
        expect(player.state()._tag).toBe('Stopped')
      }),
    ))

  it('keeps its own record of every event, ignored ones too, and tells listeners only of changes', () =>
    run(
      Effect.gen(function* () {
        const { player, heard } = yield* setup()
        yield* player.send(E.Pause({ by: bar('b0') }))
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        yield* player.send(E.Pause({ by: bar('b1') }))
        yield* player.send(E.Pause({ by: bar('b2') }))
        expect(player.log().map(step => `${step.seq} ${step.event._tag} by ${step.event.by.id} ${step.changed ? step.after._tag : 'ignored'}`)).toEqual([
          '1 Pause by b0 ignored',
          '2 Play by r1 Loading',
          // The phone says where the sound is before it says the sound has started.
          '3 Position by audio-1 ignored',
          '4 AudioReady by audio-2 Playing',
          '5 Pause by b1 Paused',
          '6 Pause by b2 ignored',
        ])
        expect(heard.map(step => step.seq)).toEqual([2, 4, 5])
        // An ignored event leaves the state as it was, in the record too.
        const ignored = player.log()[5] as PlayerStep
        expect(ignored.after).toBe(ignored.before)
      }),
    ))

  it('numbers its steps from the shared clock, so other things can be numbered in between', () =>
    run(
      Effect.gen(function* () {
        const { clock, player, heard } = yield* setup()
        expect(clock.next()).toBe(1)
        yield* player.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        expect(clock.next()).toBe(5)
        yield* player.send(E.Pause({ by: bar('b1') }))
        expect(heard.map(step => step.seq)).toEqual([2, 4, 6])
      }),
    ))

  it('events sent at the same moment are taken one at a time, in the order they were sent', () =>
    run(
      Effect.gen(function* () {
        const { player } = yield* setup()
        player.sendNow(E.Play({ note: a, by: row('r1') }))
        player.sendNow(E.Play({ note: b, by: row('r2') }))
        player.sendNow(E.Stop({ by: bar('b1') }))
        yield* tick
        yield* tick
        expect(player.log().slice(0, 3).map(step => `${step.event._tag} ${step.before._tag} to ${step.after._tag}`)).toEqual([
          'Play Stopped to Loading',
          'Play Loading to Loading',
          'Stop Loading to Stopped',
        ])
        // The phone's late answers about notes that are gone change nothing.
        expect(player.state()._tag).toBe('Stopped')
        expect(player.log().slice(3).every(step => !step.changed)).toBe(true)
      }),
    ))
})

describe('The player: where it is provided decides how long it lives', () => {
  it('two Layers make two separate players, and each stops when its Layer closes', () =>
    run(
      Effect.gen(function* () {
        // Each player has a pretend phone of its own here. On a real phone
        // there is one audio player under them all: see docs/STATE_MACHINES.md.
        const device = Phone.Device.makeTest()
        const other = Phone.Device.makeTest()
        const over = (phone: typeof device) => Player.Live.pipe(Layer.provide(Layer.merge(phone.layer, SharedClock.Live)))
        const firstScope = yield* Scope.make()
        const secondScope = yield* Scope.make()
        const first = Context.get(yield* Layer.buildWithScope(over(device), firstScope), Player)
        const second = Context.get(yield* Layer.buildWithScope(over(other), secondScope), Player)
        expect(first).not.toBe(second)
        yield* first.send(E.Play({ note: a, by: row('r1') }))
        yield* tick
        expect(first.state()._tag).toBe('Playing')
        // The other player was told nothing and knows nothing.
        expect(second.state()._tag).toBe('Stopped')
        expect(second.log()).toEqual([])
        // Closing the first one's Layer stops its sound and its actor.
        yield* Scope.close(firstScope, Exit.void)
        expect(device.audio.players[0]?.isReleased).toBe(true)
        first.sendNow(E.Pause({ by: bar('b1') }))
        yield* tick
        expect(first.log().some(step => step.event._tag === 'Pause')).toBe(false)
        // The second is still running.
        yield* second.send(E.Play({ note: b, by: row('r2') }))
        yield* tick
        expect(second.state()).toMatchObject({ _tag: 'Playing', note: b })
        expect(other.audio.players[0]?.isPlaying).toBe(true)
        yield* Scope.close(secondScope, Exit.void)
      }),
    ))
})
