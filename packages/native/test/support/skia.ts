/**
 * A stand-in for Skia's native side, for tests. It records what a program
 * asks Skia to draw, so a test can check which shapes were recorded into
 * which picture and which picture a Skia view was handed.
 *
 * On a phone these are native objects put on the JavaScript global by
 * `RNSkiaModule.install()`. See `src/skia/host.ts`.
 */
import type { SkiaHost } from '../../src/skia/index.js'

export type Op =
  | Readonly<{ op: 'circle'; cx: number; cy: number; r: number; color: string; stroke: number | undefined }>
  | Readonly<{ op: 'rect'; x: number; y: number; width: number; height: number; color: string; stroke: number | undefined }>
  | Readonly<{ op: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; stroke: number | undefined }>
  | Readonly<{ op: 'text'; text: string; x: number; y: number; color: string; size: number }>

export type FakePicture = {
  readonly ops: ReadonlyArray<Op>
  readonly bounds: unknown
  isDisposed: boolean
  dispose: () => void
}

type FakePaint = {
  color: string
  style: number
  strokeWidth: number
  setColor: (color: unknown) => void
  setStyle: (style: number) => void
  setStrokeWidth: (width: number) => void
  setAntiAlias: (on: boolean) => void
}

export const makeSkia = () => {
  /** Every picture finished, oldest first. */
  const pictures: Array<FakePicture> = []
  /** The picture each Skia view was last handed, by the view's number. */
  const shown = new Map<number, FakePicture | null>()
  /** How many times each view was asked to draw. */
  const redraws = new Map<number, number>()
  let paintsMade = 0

  const strokeOf = (paint: FakePaint): number | undefined =>
    paint.style === 1 ? paint.strokeWidth : undefined

  const host: SkiaHost = {
    api: {
      PictureRecorder: () => {
        const ops: Array<Op> = []
        let bounds: unknown
        return {
          beginRecording: at => {
            bounds = at
            return {
              drawCircle: (cx, cy, r, paint) => {
                const p = paint as unknown as FakePaint
                ops.push({ op: 'circle', cx, cy, r, color: p.color, stroke: strokeOf(p) })
              },
              drawRect: (rect, paint) => {
                const p = paint as unknown as FakePaint
                ops.push({ op: 'rect', ...rect, color: p.color, stroke: strokeOf(p) })
              },
              drawLine: (x1, y1, x2, y2, paint) => {
                const p = paint as unknown as FakePaint
                ops.push({ op: 'line', x1, y1, x2, y2, color: p.color, stroke: strokeOf(p) })
              },
              drawText: (text, x, y, paint, font) => {
                const p = paint as unknown as FakePaint
                ops.push({ op: 'text', text, x, y, color: p.color, size: (font as { size: number }).size })
              },
            }
          },
          finishRecordingAsPicture: () => {
            const picture: FakePicture = {
              ops,
              bounds,
              isDisposed: false,
              dispose: () => {
                picture.isDisposed = true
              },
            }
            pictures.push(picture)
            return picture
          },
          dispose: () => {},
        }
      },
      Paint: () => {
        paintsMade += 1
        const paint: FakePaint = {
          color: '',
          style: 0,
          strokeWidth: 0,
          setColor: color => {
            paint.color = (color as { css: string }).css
          },
          setStyle: style => {
            paint.style = style
          },
          setStrokeWidth: width => {
            paint.strokeWidth = width
          },
          setAntiAlias: () => {},
        }
        return paint
      },
      Color: value => ({ css: value }),
      Font: (_typeface, size) => ({ size }),
      FontMgr: { System: () => ({ matchFamilyStyle: name => ({ family: name }) }) },
    },
    views: {
      setJsiProperty: (nativeId, name, value) => {
        if (name === 'picture') shown.set(nativeId, value as FakePicture | null)
      },
      requestRedraw: nativeId => {
        redraws.set(nativeId, (redraws.get(nativeId) ?? 0) + 1)
      },
    },
  }

  return { host, pictures, shown, redraws, paintsMade: () => paintsMade }
}
