/** On native, Legend's `flushSync` only runs the function. So does this. */
export const flushSync = (fn: () => void): void => {
  fn()
}
