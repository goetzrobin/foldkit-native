/*
 * Copied from Effect UI's Snake example: examples/snake/src/domain/direction.ts
 * at commit c73e7ce of the Effect UI repository. Not changed: everything
 * under this comment is the original file, byte for byte.
 *
 * MIT License
 * Copyright (c) 2023 Effectful Technologies Inc
 * The full licence text is in ../LICENSE-effect-ui.
 */
import { Match, Schema } from "effect"

export const Direction = Schema.Literals(["Up", "Down", "Left", "Right"])
export type Direction = typeof Direction.Type

export const opposite = (direction: Direction): Direction =>
  Match.value(direction).pipe(
    Match.withReturnType<Direction>(),
    Match.when("Up", () => "Down"),
    Match.when("Down", () => "Up"),
    Match.when("Left", () => "Right"),
    Match.when("Right", () => "Left"),
    Match.exhaustive
  )

export const isOpposite = (a: Direction, b: Direction): boolean =>
  opposite(a) === b
