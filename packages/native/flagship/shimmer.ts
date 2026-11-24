/**
 * The "Thinking" label shown before a reply's first word, with a slow band
 * of light passing over it.
 *
 * Drawn with Skia, frame by frame, with no Message and no view call per
 * frame. The word is drawn in full ink, then a veil in the screen's colour
 * is laid over it in thin vertical strips. The veil is thick everywhere but
 * where the band is, so the word looks grey with a brighter band moving
 * across it. One sweep takes `MOTION.shimmerSweep`.
 *
 * Where Skia is missing (Expo Go without it, the tests) the label is plain
 * grey text, which is a fine way to say the same thing.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { prop, style } from '../src/attributes.js'
import { text } from '../src/elements.js'
import { type CanvasSurface, type Scene, canvas, rendererFor } from '../src/skia/index.js'
import { MOTION, type Palette, TYPE } from './theme.js'

type ShimmerProps = Readonly<{
  label: string
  ink: string
  veil: readonly [number, number, number]
}>

/** How wide the bright band is, in points, from its middle to where it fades out. */
const BAND = 26
/** How much of the screen's colour lies over the word away from the band. */
const VEIL = 0.6
const STRIP = 2
const FONT_SIZE = TYPE.meta.fontSize

/** A smooth step from 0 to 1. */
const ease = (t: number): number => t * t * (3 - 2 * t)

export const SHIMMER: Scene<ShimmerProps> = {
  start: (surface: CanvasSurface, initial: ShimmerProps) => {
    let props = initial
    let isRunning = true
    const paint = (nowMs: number): void => {
      if (!isRunning) return
      const { width, height } = surface.size()
      if (width > 0) {
        const travel = width + 2 * BAND
        const middle = ((nowMs % MOTION.shimmerSweep) / MOTION.shimmerSweep) * travel - BAND
        surface.draw(pen => {
          pen.text(props.label, 0, (height - FONT_SIZE * 1.2) / 2, { color: props.ink, size: FONT_SIZE })
          const [r, g, b] = props.veil
          for (let x = 0; x < width; x += STRIP) {
            const distance = Math.abs(x + STRIP / 2 - middle)
            const light = ease(Math.max(0, 1 - distance / BAND))
            // A few steps of alpha, so only a handful of paints are ever made.
            const alpha = Math.round(VEIL * (1 - light) * 20) / 20
            if (alpha <= 0) continue
            pen.rect(x, 0, STRIP, height, { color: `rgba(${r},${g},${b},${alpha})` })
          }
        })
      }
      surface.frame(paint)
    }
    surface.frame(paint)
    return {
      update: next => {
        props = next
      },
      stop: () => {
        isRunning = false
      },
    }
  },
}

/** The label, in a row of its own. `testID` is `thinking` either way. */
export const thinkingLabel = <Message>(h: HtmlBuilder<Message>, palette: Palette): Html =>
  rendererFor('auto') === 'skia'
    ? canvas(
        h,
        {
          id: 'thinking',
          scene: SHIMMER,
          props: { label: 'Thinking', ink: palette.ink, veil: palette.shimmerVeil },
        },
        [prop('accessibilityLabel', 'Thinking'), style({ width: 76, height: TYPE.meta.lineHeight })],
      )
    : text(
        [prop('testID', 'thinking'), style({ ...TYPE.meta, color: palette.ink3 })],
        ['Thinking'],
      )
