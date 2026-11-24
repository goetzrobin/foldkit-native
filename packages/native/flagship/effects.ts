/**
 * The phone's small side effects that several parts of Fold Chat ask for:
 * a haptic, putting the keyboard away. Each part maps the result to a Message
 * of its own that changes nothing (`CompletedSideEffect`).
 */
import { Command } from 'foldkit'

import { Haptics, Keyboard } from '../src/device/index.js'

export const haptics = <Message>(done: () => Message) => ({
  light: () => Command.mapMessage(Haptics.Impact({ style: 'light' }), done),
  medium: () => Command.mapMessage(Haptics.Impact({ style: 'medium' }), done),
  tick: () => Command.mapMessage(Haptics.Select(), done),
  success: () => Command.mapMessage(Haptics.Notify({ type: 'success' }), done),
  warning: () => Command.mapMessage(Haptics.Notify({ type: 'warning' }), done),
  error: () => Command.mapMessage(Haptics.Notify({ type: 'error' }), done),
})

export const dismissKeyboard = <Message>(done: () => Message) =>
  Command.mapMessage(Keyboard.Dismiss(), done)
