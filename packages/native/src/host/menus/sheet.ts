/**
 * The phone's own list of choices that slides up or pops up, reached with
 * no React and no import of `react-native`.
 *
 * - iOS: the action sheet. React Native's native module `ActionSheetManager`
 *   (what `ActionSheetIOS` calls).
 * - Android: a dialog with a list. React Native's native module
 *   `DialogManagerAndroid` (what `Alert` calls), with its `items` option.
 *
 * Both are part of React Native itself, so every build has them, Expo Go
 * included. They are found where React Native finds them: the function
 * `globalThis.__turboModuleProxy`, or the object `globalThis.nativeModuleProxy`.
 *
 * Nothing here throws while looking. `sheetRoute()` says which of the two
 * this phone has, or `'none'`.
 */
import { platformName } from '../../foldkit/controls/expoUi.js'

export type SheetOption = Readonly<{
  key: string
  title: string
  isDestructive?: boolean | undefined
  isDisabled?: boolean | undefined
}>

export type SheetRequest = Readonly<{
  title?: string | undefined
  message?: string | undefined
  options: ReadonlyArray<SheetOption>
  /** What the button that closes the sheet says on iOS. "Cancel" unless said. */
  cancelLabel?: string | undefined
}>

/** How a sheet ended: a choice, or closed without one. */
export type SheetAnswer = Readonly<{ _tag: 'Selected'; key: string }> | Readonly<{ _tag: 'Dismissed' }>

export type SheetRoute = 'ios-action-sheet' | 'android-dialog' | 'none'

/** Finds one of React Native's native modules by name, or nothing. */
export type NativeModuleLookup = (name: string) => unknown

let lookup: NativeModuleLookup | 'global' = 'global'

/** Tests pass a stand-in. `'global'` (the default) asks React Native's own registry. */
export const configureSheets = (options: Readonly<{ nativeModule?: NativeModuleLookup | 'global' }>) => {
  if (options.nativeModule !== undefined) lookup = options.nativeModule
}

type Globals = {
  __turboModuleProxy?: (name: string) => unknown
  nativeModuleProxy?: Record<string, unknown>
}

const nativeModule = (name: string): unknown => {
  try {
    if (lookup !== 'global') return lookup(name) ?? undefined
    const host = globalThis as Globals
    const turbo = typeof host.__turboModuleProxy === 'function' ? host.__turboModuleProxy(name) : null
    return turbo ?? host.nativeModuleProxy?.[name] ?? undefined
  } catch {
    return undefined
  }
}

type ActionSheetManager = {
  showActionSheetWithOptions: (options: object, callback: (index: number) => void) => void
}

type DialogManager = {
  showAlert: (
    config: object,
    onError: (error: string) => void,
    onAction: (action: string, buttonKey?: number) => void,
  ) => void
}

const ACTION_SHEET = 'ActionSheetManager'
const DIALOG = 'DialogManagerAndroid'

const actionSheet = (): ActionSheetManager | undefined => {
  const module = nativeModule(ACTION_SHEET) as Partial<ActionSheetManager> | undefined
  return typeof module?.showActionSheetWithOptions === 'function'
    ? (module as ActionSheetManager)
    : undefined
}

const dialog = (): DialogManager | undefined => {
  const module = nativeModule(DIALOG) as Partial<DialogManager> | undefined
  return typeof module?.showAlert === 'function' ? (module as DialogManager) : undefined
}

/** Which native list of choices this phone has. Never throws. */
export const sheetRoute = (): SheetRoute => {
  const platform = platformName()
  if (platform === 'android') return dialog() === undefined ? 'none' : 'android-dialog'
  if (platform === 'ios') return actionSheet() === undefined ? 'none' : 'ios-action-sheet'
  return 'none'
}

/** The route in words, for a line on screen. */
export const sheetRouteName = (): string => {
  const route = sheetRoute()
  if (route === 'ios-action-sheet') return "React Native's action sheet (ActionSheetManager)"
  if (route === 'android-dialog') return "React Native's list dialog (DialogManagerAndroid)"
  return 'not available'
}

/**
 * Shows the list and calls `done` once, with the choice or with
 * `Dismissed`. Throws when this phone has no such list or the call fails.
 */
export const presentSheet = (request: SheetRequest, done: (answer: SheetAnswer) => void): void => {
  let isDone = false
  const finish = (answer: SheetAnswer): void => {
    if (isDone) return
    isDone = true
    done(answer)
  }
  const route = sheetRoute()
  if (route === 'ios-action-sheet') {
    const options = request.options
    const indices = (keep: (option: SheetOption) => boolean): Array<number> =>
      options.flatMap((option, index) => (keep(option) ? [index] : []))
    actionSheet()?.showActionSheetWithOptions(
      {
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.message === undefined ? {} : { message: request.message }),
        options: [...options.map(option => option.title), request.cancelLabel ?? 'Cancel'],
        cancelButtonIndex: options.length,
        destructiveButtonIndices: indices(option => option.isDestructive === true),
        disabledButtonIndices: indices(option => option.isDisabled === true),
      },
      index => {
        const chosen = options[index]
        finish(chosen === undefined ? { _tag: 'Dismissed' } : { _tag: 'Selected', key: chosen.key })
      },
    )
    return
  }
  if (route === 'android-dialog') {
    // The dialog cannot grey a line out, so a disabled one is left out. It
    // also drops its list when it has a message, so the message is the
    // title when there is no title, and is otherwise not shown.
    const options = request.options.filter(option => option.isDisabled !== true)
    const title = request.title ?? request.message
    dialog()?.showAlert(
      {
        ...(title === undefined ? {} : { title }),
        items: options.map(option => option.title),
        cancelable: true,
      },
      error => {
        // Told from inside the phone's own callback, where a throw would
        // reach nobody. The sheet is over either way.
        console.warn(`[foldkit-native] the list dialog failed: ${error}`)
        finish({ _tag: 'Dismissed' })
      },
      (action, buttonKey) => {
        const chosen = action === 'buttonClicked' && buttonKey !== undefined ? options[buttonKey] : undefined
        finish(chosen === undefined ? { _tag: 'Dismissed' } : { _tag: 'Selected', key: chosen.key })
      },
    )
    return
  }
  throw new Error(
    platformName() === 'android'
      ? "React Native's DialogManagerAndroid is not in this build"
      : platformName() === 'ios'
        ? "React Native's ActionSheetManager is not in this build"
        : `There is no native list of choices on ${platformName()}`,
  )
}
