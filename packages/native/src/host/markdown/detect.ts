/**
 * Whether this build of the app has react-native-enriched-markdown's native
 * view, and the helper that finishes half-written Markdown.
 *
 * The native view is Software Mansion's, from `react-native-enriched-markdown`
 * 1.2.0. It is a plain React Native (Fabric) component, not an Expo module,
 * so it is looked for the way React Native itself looks for one:
 * `globalThis.__nativeComponentRegistry__hasComponent(name)`. React Native
 * installs that function on both platforms (`RCTComponentViewFactory.mm` on
 * iOS, `ComponentNameResolverBinding.cpp` on Android) and it answers whether
 * a component of that name was built into the app.
 *
 * Expo Go does not contain this package, so there the answer is no, and
 * `markdown` draws with the plain Foldkit fallback instead.
 *
 * `remend` (Vercel's "self-healing Markdown", 1.5.0) is pure JavaScript. The
 * app imports it and hands it over, as it hands over the phone modules, so
 * this package needs no npm dependency of its own:
 *
 *   import remend from 'remend'
 *   configureMarkdown({ remend })
 *
 * Nothing in this file throws.
 */

/** The native component's name, from `codegenNativeComponent('EnrichedMarkdown')`. */
export const NATIVE_MARKDOWN_VIEW = 'EnrichedMarkdown'

/** The options remend takes. Only what this project sets is named. */
export type RemendOptions = Readonly<Record<string, unknown>>

/** `remend(text, options)` from the `remend` package. */
export type Remend = (text: string, options?: RemendOptions) => string

export type MarkdownSetup = Readonly<{
  /**
   * `true` or `false` says whether the native view is in the build, without
   * looking. `false` sends every `markdown` to the Foldkit fallback.
   * `'detect'` (the default) looks.
   */
  native?: boolean | 'detect'
  /**
   * Asks whether a native component of a name is in the build. Defaults to
   * React Native's `__nativeComponentRegistry__hasComponent`. Tests pass a
   * stand-in. `null` says there is no way to ask.
   */
  hasComponent?: ((name: string) => boolean) | null
  /** `remend` from the `remend` package. Without it, half-written syntax shows as it is. */
  remend?: Remend | null
}>

type Found = Readonly<{ isAvailable: boolean; reason: string }>

let given: boolean | 'detect' = 'detect'
let asker: ((name: string) => boolean) | null | 'global' = 'global'
let remender: Remend | null = null
let found: Found | undefined

/** Call at startup, before the first draw. Later calls change only what they name. */
export const configureMarkdown = (setup: MarkdownSetup): void => {
  if (setup.native !== undefined) given = setup.native
  if (setup.hasComponent !== undefined) asker = setup.hasComponent
  if (setup.remend !== undefined) remender = setup.remend
  found = undefined
}

/** Back to the state before `configureMarkdown`. For tests. */
export const resetMarkdownSetup = (): void => {
  given = 'detect'
  asker = 'global'
  remender = null
  found = undefined
}

/** The remend function the app handed over, or null. */
export const remendOf = (): Remend | null => remender

/** Said wherever the native code is missing. The demo and the docs use the same words. */
export const NEEDS_PREBUILT =
  "react-native-enriched-markdown's native code is not in this build (Expo Go). Build the app: see docs/MARKDOWN.md"

const hasComponentFunction = (): ((name: string) => boolean) | null => {
  if (asker !== 'global') return asker
  const global = (globalThis as { __nativeComponentRegistry__hasComponent?: unknown })
    .__nativeComponentRegistry__hasComponent
  return typeof global === 'function' ? (global as (name: string) => boolean) : null
}

const detect = (): Found => {
  try {
    const ask = hasComponentFunction()
    if (ask === null) {
      return { isAvailable: false, reason: "React Native's list of native views cannot be read here" }
    }
    return ask(NATIVE_MARKDOWN_VIEW) === true
      ? { isAvailable: true, reason: '' }
      : { isAvailable: false, reason: NEEDS_PREBUILT }
  } catch (error) {
    return {
      isAvailable: false,
      reason: `looking for the native view failed (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

const resolved = (): Found => {
  if (given !== 'detect') {
    return { isAvailable: given, reason: given ? '' : 'switched off by the app' }
  }
  // Asked once: a build does not gain or lose native code while it runs.
  if (found === undefined) found = detect()
  return found
}

/** Whether the native Markdown view is in this build. Never throws. */
export const isNativeMarkdownAvailable = (): boolean => resolved().isAvailable

/** Why the native view is not there, in plain words. Empty when it is. */
export const nativeMarkdownUnavailableReason = (): string => resolved().reason
