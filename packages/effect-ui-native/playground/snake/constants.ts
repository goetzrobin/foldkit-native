/*
 * Copied from Effect UI's Snake example: examples/snake/src/constants.ts
 * at commit c73e7ce of the Effect UI repository. Not changed: everything
 * under this comment is the original file, byte for byte.
 *
 * MIT License
 * Copyright (c) 2023 Effectful Technologies Inc
 * The full licence text is in ./LICENSE-effect-ui.
 */
export const GAME = {
  INITIAL_POSITION: { x: 10, y: 10 },
  INITIAL_DIRECTION: "Right",
  POINTS_PER_APPLE: 10
} as const

export const GAME_SPEED = {
  MIN_INTERVAL: 80,
  BASE_INTERVAL: 150
} as const
