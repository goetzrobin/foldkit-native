/**
 * The word "Thinking", shown before a reply's first word, with a slow band
 * of light passing over it.
 *
 * Drawn with Skia, frame by frame, with no Message and no view call per
 * frame. The word is drawn in full ink, then a veil in the screen's colour
 * is laid over it in thin strips. The veil is thick everywhere but where
 * the band is, so the word looks grey with a brighter band moving across
 * it. One sweep takes 1.4 seconds.
 *
 * Where the build has no Skia (and in the tests) the word is plain grey
 * text. The drawing is Fold Chat's (`packages/native/flagship/shimmer.ts`).
 */
import { Schema } from 'effect'

import { type Native, NativeViews } from '../src/index.js'
import { MOTION, type Palette, TYPE } from './theme.js'

/** How wide the bright band is, in points, from its middle to where it fades out. */
const BAND = 26
/** How much of the screen's colour lies over the word away from the band. */
const VEIL = 0.6
const STRIP = 2
const FONT_SIZE = TYPE.meta.fontSize

/** A smooth step from 0 to 1. */
const ease = (t: number): number => t * t * (3 - 2 * t)

const DrawShimmer = NativeViews.makeCanvas(
  'DrawShimmer',
  { label: Schema.String, ink: Schema.String, red: Schema.Number, green: Schema.Number, blue: Schema.Number },
  (pen, size, props, nowMs) => {
    const { width, height } = size
    if (width <= 0) return
    const travel = width + 2 * BAND
    const middle = ((nowMs % MOTION.shimmerSweep) / MOTION.shimmerSweep) * travel - BAND
    pen.text(props.label, 0, (height - FONT_SIZE * 1.2) / 2, { color: props.ink, size: FONT_SIZE })
    for (let x = 0; x < width; x += STRIP) {
      const distance = Math.abs(x + STRIP / 2 - middle)
      const light = ease(Math.max(0, 1 - distance / BAND))
      // A few steps of alpha, so only a handful of paints are ever made.
      const alpha = Math.round(VEIL * (1 - light) * 20) / 20
      if (alpha <= 0) continue
      pen.rect(x, 0, STRIP, height, { color: `rgba(${props.red},${props.green},${props.blue},${alpha})` })
    }
  },
  { everyFrame: true },
)

/** The label. `id` is its `testID` either way. */
export const thinkingLabel = <Msg>(h: Native.H<Msg>, palette: Palette, id: string) =>
  NativeViews.isSkiaAvailable()
    ? h.view
        .key('thinking')
        .testId(id)
        .set({ accessibilityLabel: 'Thinking' })
        .style({ width: 76, height: TYPE.meta.lineHeight })
        .onMount(
          DrawShimmer({
            label: 'Thinking',
            ink: palette.ink,
            red: palette.shimmerVeil[0],
            green: palette.shimmerVeil[1],
            blue: palette.shimmerVeil[2],
          }),
        )
    : h.text.key('thinking').testId(id).style({ ...TYPE.meta, color: palette.ink3 }).children('Thinking')
