/**
 * The app's theme setting, told to the phone.
 *
 * Fold Chat's own views read the scheme from the Model. The phone's views
 * (the bar, menus, sheets, the keyboard, Liquid Glass) read it from the
 * phone. React Native's `Appearance.setColorScheme` sets the whole app's
 * scheme on the phone ("light", "dark", or back to following the system),
 * so both agree. The phone then reports the new scheme through
 * `Phone.ColorScheme`, which is where the Model hears it. The Command also
 * reads the scheme back at once, in case the report is late or missing.
 */
import { Context, Effect, Layer } from 'effect'

import type { ThemePref } from './model.js'

export type AppearanceService = Readonly<{
  /** Sets the app's scheme and answers with what the phone shows now. */
  set: (pref: ThemePref) => Effect.Effect<'light' | 'dark'>
}>

export class Appearance extends Context.Service<Appearance, AppearanceService>()('fold-chat/Appearance') {}

/** The part of React Native's `Appearance` used here. */
export type AppearanceModule = Readonly<{
  setColorScheme?: (scheme: 'light' | 'dark' | 'unspecified') => void
  getColorScheme: () => string | null | undefined
}>

export const appearanceLive = (module: AppearanceModule): Layer.Layer<Appearance> =>
  Layer.succeed(Appearance, {
    set: pref =>
      Effect.sync(() => {
        try {
          module.setColorScheme?.(pref === 'system' ? 'unspecified' : pref)
        } catch {
          // An old React Native without the call: the app follows the phone.
        }
        return module.getColorScheme() === 'dark' ? 'dark' : 'light'
      }),
  })

/**
 * A fake. `system` is what the phone is set to. `calls` lists each setting
 * the app asked for. `onSet` lets a test make the fake phone report it.
 */
export const appearanceTest = (options: Readonly<{ system?: 'light' | 'dark'; onSet?: (scheme: 'light' | 'dark') => void }> = {}) => {
  const calls: Array<ThemePref> = []
  const layer = Layer.succeed(Appearance, {
    set: pref =>
      Effect.sync(() => {
        calls.push(pref)
        const scheme = pref === 'system' ? (options.system ?? 'light') : pref
        options.onSet?.(scheme)
        return scheme
      }),
  })
  return { layer, calls }
}
