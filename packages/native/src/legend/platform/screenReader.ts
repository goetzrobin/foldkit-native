/**
 * Whether a screen reader (VoiceOver, TalkBack) is on. Legend reads it to
 * tell a screen reader's scroll from a finger's. React Native's
 * `AccessibilityInfo` answers that and this adapter does not import React
 * Native, so the answer is "off" unless the app sets it.
 *
 * Not wired to the phone yet: see the report's "App needs".
 */
let enabled = false

export const isScreenReaderEnabled = (): boolean => enabled

export const setScreenReaderEnabled = (value: boolean): void => {
  enabled = value
}

/** Legend's component calls this on mount. Nothing to listen to here. */
export const subscribeScreenReader = (): (() => void) => () => {}
