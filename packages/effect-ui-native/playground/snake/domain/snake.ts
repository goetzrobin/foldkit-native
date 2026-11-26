/*
 * Copied from Effect UI's Snake example: examples/snake/src/domain/snake.ts
 * at commit c73e7ce of the Effect UI repository. Not changed: everything
 * under this comment is the original file, byte for byte.
 *
 * MIT License
 * Copyright (c) 2023 Effectful Technologies Inc
 * The full licence text is in ../LICENSE-effect-ui.
 */
import { Array, Schema } from "effect"

import type { Direction } from "./direction.ts"
import * as Position from "./position.ts"

export const INITIAL_LENGTH = 3

export const Snake = Schema.NonEmptyArray(Position.Position)
export type Snake = typeof Snake.Type

export const create = (startPos: Position.Position): Snake =>
  Array.makeBy(INITIAL_LENGTH, (i) => ({
    x: startPos.x - i,
    y: startPos.y
  }))

export const move = (snake: Snake, direction: Direction): Snake =>
  Array.matchLeft(snake, {
    onEmpty: () => snake,
    onNonEmpty: (head, tail) => {
      const newHead = Position.move(head, direction)
      return [newHead, head, ...Array.dropRight(tail, 1)]
    }
  })

export const grow = (snake: Snake, direction: Direction): Snake =>
  Array.matchLeft(snake, {
    onEmpty: () => snake,
    onNonEmpty: (head, tail) => {
      const newHead = Position.move(head, direction)
      return [newHead, head, ...tail]
    }
  })

export const hasCollision = (snake: Snake): boolean =>
  Array.matchLeft(snake, {
    onEmpty: () => false,
    onNonEmpty: (head, tail) =>
      Array.some(tail, (segment) => Position.equivalence(head, segment))
  })

export const contains = (snake: Snake, pos: Position.Position): boolean =>
  Array.some(snake, (segment) => Position.equivalence(segment, pos))
