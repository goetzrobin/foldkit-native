/**
 * The same `Player` Layer, provided around one screen in place of the whole
 * app. Each screen then has a player of its own, and that player stops when
 * its screen goes.
 *
 * Effect Chat does not do this: it provides the player once, where the app
 * starts. This test shows that where the player lives is decided by where
 * its Layer is provided, and by nothing in the player's own code.
 */
import { Command, Component, UiSchema } from '@effect/ui'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { SharedClock } from '../chat/clock.js'
import { Player, PlayerEvent, PlayerState, PlayerStep, SendToPlayer, heardPlayer, sender } from '../chat/playback.js'
import { Native, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { provideForTest, run } from './support.js'

const ScreenMessage = UiSchema.TaggedEnum({ PressedPlay: {}, HeardPlayer: { step: PlayerStep }, Sent: {} })

/** A screen with one voice note, a play button, and the player's state as words. */
const Screen = Native.component({
  name: 'NoteScreen',
  props: Schema.Struct({ id: Schema.String }),
  model: Schema.Struct({ player: PlayerState }),
  message: ScreenMessage,
}).make({
  init: () => ({ player: PlayerState.Stopped }),
  update: {
    PressedPlay: $ =>
      $.run(
        SendToPlayer.make({
          event: PlayerEvent.Play({
            note: { uri: `file:///${$.props.id}.m4a`, label: `Note ${$.props.id}` },
            by: sender('screen', $.props.id),
          }),
        }).pipe(Command.as(ScreenMessage.Sent())),
      ),
    HeardPlayer: ($, { step }) => $.evolve({ player: step.after }),
    Sent: $ => $.model,
  },
  subscriptions: () => [heardPlayer(step => ScreenMessage.HeardPlayer({ step }), { positions: false })],
  view: (h, model) =>
    h.view.children(
      h.pressable.testId(`play-${h.props.id}`).on('press', ScreenMessage.PressedPlay()).children(h.text('play')),
      h.text.testId(`state-${h.props.id}`).children(model.player._tag),
    ),
})

/** The screen with a player of its own: built when the screen appears, closed when it goes. */
const ScreenWithOwnPlayer = Component.provide(Screen, Layer.provideMerge(SendToPlayer.layer, Player.Live), { local: true })

const AppMessage = UiSchema.TaggedEnum({ PressedClose: { id: Schema.String } })

const TwoScreens = Native.component({
  name: 'TwoScreens',
  model: Schema.Struct({ open: Schema.Array(Schema.String) }),
  message: AppMessage,
}).make({
  init: () => ({ open: ['a', 'b'] }),
  update: { PressedClose: ($, { id }) => $.evolve({ open: $.model.open.filter(each => each !== id) }) },
  view: (h, model) =>
    h.view.children(
      model.open.map(id => ScreenWithOwnPlayer(h, { key: id, props: { id } })),
      h.pressable.testId('close-a').on('press', AppMessage.PressedClose({ id: 'a' })).children(h.text('close a')),
    ),
})

describe('The player, provided around one screen', () => {
  it('each screen has its own player, and closing a screen stops its player', () =>
    run(
      Effect.gen(function* () {
        const device = Phone.Device.makeTest()
        const app = yield* NativeTest.mount(TwoScreens, {}).pipe(
          provideForTest(Layer.merge(device.layer, SharedClock.Live)),
        )
        yield* app.wait(40)
        expect(app.text('state-a')).toBe('Stopped')
        expect(app.text('state-b')).toBe('Stopped')

        yield* app.press('play-a')
        yield* app.wait(60)
        // Screen a's player plays. Screen b's player was told nothing.
        expect(app.text('state-a')).toBe('Playing')
        expect(app.text('state-b')).toBe('Stopped')
        expect(device.audio.players.map(each => each.uri)).toEqual(['file:///a.m4a'])
        expect(device.audio.players[0]?.isPlaying).toBe(true)

        // Screen a goes. Its player goes with it, and lets the phone's sound go.
        yield* app.press('close-a')
        yield* app.wait(60)
        expect(app.has('state-a')).toBe(false)
        expect(device.audio.players[0]?.isPlaying).toBe(false)
        expect(device.audio.players[0]?.isReleased).toBe(true)

        // Screen b's player is still there and works.
        yield* app.press('play-b')
        yield* app.wait(60)
        expect(app.text('state-b')).toBe('Playing')
        expect(device.audio.players.at(-1)?.uri).toBe('file:///b.m4a')
        expect(device.audio.players.at(-1)?.isPlaying).toBe(true)
      }),
    ))
})
