/**
 * Legend wraps a group of changes in React's `unstable_batchedUpdates` so
 * React draws once for all of them. There is no React here. Our driver
 * collects changes itself and commits once (see `driver.ts`), so this only
 * has to run the function.
 */
export const batchedUpdates = (fn: () => void): void => {
  fn()
}
