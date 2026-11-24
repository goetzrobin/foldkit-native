/**
 * The object tracking game (MOT).
 *
 * `mot.ts` is the simulation: pure functions, no drawing. `arena.ts` is the
 * loop that runs it and draws it on a canvas every frame.
 */
export { DEFAULT_COLORS, motArena } from './arena.js'
export type { ArenaColors, MotArena, MovementEnded, Phase } from './arena.js'
export {
  STEP_MS,
  dotAt,
  drawnPositions,
  initialState,
  isFinished,
  isTarget,
  makeRandom,
  scoreTrial,
  stateAt,
  step,
  summarise,
} from './mot.js'
export type { Dot, MotState, Point, Timing, TrialResult, TrialSpec } from './mot.js'
