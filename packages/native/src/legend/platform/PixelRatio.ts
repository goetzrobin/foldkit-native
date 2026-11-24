/**
 * How many screen pixels make one point. Legend uses it only to decide how
 * small a difference between two measured sizes still counts as "the same":
 * one pixel. The app may set the real ratio; 3 is right for most phones sold
 * now, and a wrong value only makes that tolerance a little tighter or looser.
 */
let ratio = 3

export const setPixelRatio = (value: number): void => {
  if (Number.isFinite(value) && value > 0) ratio = value
}

export const PixelRatio = { get: (): number => ratio }
