/** Shared by the Snake tests: reading the board and the digits off the simulated phone. */
import type { FakeFabricNode } from '@ng-native/testing/fake'

import * as Look from '../playground/snake/look.js'
import type { NativeTest } from '../src/testing/index.js'

type App = Pick<NativeTest.MountedApp<any, any>, 'byTestId'>

/** What a committed cell shows, from its colour and shape alone. */
const kindOf = (cell: FakeFabricNode): string => {
  if (cell.props['backgroundColor'] === Look.LCD_OFF) return '.'
  if (cell.props['backgroundColor'] !== Look.LCD_ON) return '?'
  return typeof cell.props['borderRadius'] === 'number' ? 'o' : '#'
}

/** The board as the phone has it: 20 lines, `#` a piece of snake, `o` the apple, `.` nothing. */
export const boardOf = (app: App): ReadonlyArray<string> =>
  app
    .byTestId('snake-board')
    .children.filter(row => row.children.length === 20 && row.children.every(cell => cell.children.length === 0))
    .map(row => row.children.map(kindOf).join(''))

/** The cells of the board that show `kind`, as `x,y`. */
export const cellsOf = (app: App, kind: string): ReadonlyArray<string> =>
  boardOf(app).flatMap((row, y) => [...row].flatMap((letter, x) => (letter === kind ? [`${x},${y}`] : [])))

/** A score read back from its squares: each digit's lit squares, looked up in the table of digits. */
export const digitsOf = (app: App, id: string): string =>
  app
    .byTestId(id)
    .children.map(digit => {
      const lit = digit.children.map(row => row.children.map(dot => (dot.props['backgroundColor'] === Look.LCD_ON ? '#' : '.')).join(''))
      const found = Look.DIGITS.findIndex(shape => shape.join('|') === lit.join('|'))
      return found === -1 ? '?' : String(found)
    })
    .join('')
