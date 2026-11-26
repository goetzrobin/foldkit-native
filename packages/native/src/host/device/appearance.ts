/**
 * The app's own light or dark setting, told to the phone.
 *
 * A program draws its own views from the scheme in its Model. The phone's
 * views (the title bar, menus, sheets, the keyboard, Liquid Glass) read the
 * scheme from the phone. React Native's `Appearance.setColorScheme` sets the
 * whole app's scheme on the phone: light, dark, or back to following the
 * phone's setting. So both agree. The phone then reports the new scheme
 * through `ColorScheme`, which is where a program hears it. `set` also reads
 * the scheme back at once, in case that report is late.
 *
 * This is Fold Chat's `Appearance` (`packages/native/flagship/appearance.ts`),
 * moved to the host so a program that is not Fold Chat can use it.
 */
import { Context, Effect, Layer } from 'effect'

/** `system`: follow the phone. */
export type ThemePreference = 'system' | 'light' | 'dark'

export type AppearanceService = Readonly<{
  /** Sets the app's scheme and answers with what the phone shows now. */
  set: (preference: ThemePreference) => Effect.Effect<'light' | 'dark'>
}>

export class Appearance extends Context.Service<Appearance, AppearanceService>()('foldkit-native/Appearance') {}

/** The part of React Native's `Appearance` used here. */
export type AppearanceSetter = Readonly<{
  setColorScheme?: (scheme: 'light' | 'dark' | 'unspecified') => void
  getColorScheme: () => string | null | undefined
}>

export const live = (module: AppearanceSetter): Layer.Layer<Appearance> =>
  Layer.succeed(Appearance, {
    set: preference =>
      Effect.sync(() => {
        try {
          module.setColorScheme?.(preference === 'system' ? 'unspecified' : preference)
        } catch {
          // An old React Native without the call: the app follows the phone.
        }
        return module.getColorScheme() === 'dark' ? 'dark' : 'light'
      }),
  })

/**
 * A fake. `system` is what the phone is set to. `calls` lists each setting
 * the program asked for. `onSet` lets a test make its fake phone report it.
 */
export const makeTest = (
  options: Readonly<{ system?: 'light' | 'dark'; onSet?: (scheme: 'light' | 'dark') => void }> = {},
) => {
  const calls: Array<ThemePreference> = []
  const layer = Layer.succeed(Appearance, {
    set: preference =>
      Effect.sync(() => {
        calls.push(preference)
        const scheme = preference === 'system' ? (options.system ?? 'light') : preference
        options.onSet?.(scheme)
        return scheme
      }),
  })
  return { layer, calls }
}
