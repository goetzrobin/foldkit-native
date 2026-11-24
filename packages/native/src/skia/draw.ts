/**
 * The drawing layer: a small "pen" with four shapes, and two ways to put
 * what it draws on the phone.
 *
 *   surface.draw(pen => {
 *     pen.circle(40, 40, 14, { color: '#ffffff' })
 *     pen.line(0, 0, 100, 100, { color: '#ff0000', stroke: 2 })
 *   })
 *
 * Each call to `draw` is one whole frame. It replaces the frame before.
 *
 * - The Skia pen records the calls into a Skia picture (`PictureRecorder`)
 *   and hands the picture to the Skia view. No React is involved.
 * - The plain pen keeps a pool of ordinary views. The first circle drawn in
 *   a frame is the first circle view, the second is the second, and so on.
 *   Each frame it moves and recolors the views it has, makes more if the
 *   frame draws more, and hides the ones the frame did not use.
 *
 * The same drawing code works with both, which is how the game falls back
 * to plain views where Skia is missing.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'

import type { SkCanvas, SkPaint, SkPicture, SkiaHost } from './host.js'

export type Paint = Readonly<{
  /** CSS color text, such as `#ffffff`. */
  color: string
  /**
   * Leave out to fill the shape. A number draws the outline only, this many
   * points thick. For a line it is the line's thickness (1 if left out).
   */
  stroke?: number
}>

export type TextPaint = Readonly<{ color: string; size: number }>

export type Pen = Readonly<{
  circle: (cx: number, cy: number, radius: number, paint: Paint) => void
  rect: (x: number, y: number, width: number, height: number, paint: Paint) => void
  line: (x1: number, y1: number, x2: number, y2: number, paint: Paint) => void
  /** `x`, `y` is the top left corner of the line of text. */
  text: (value: string, x: number, y: number, paint: TextPaint) => void
}>

export type Size = Readonly<{ width: number; height: number }>

/** One way of putting frames on the phone. */
export type Painter = Readonly<{
  /** Draws one whole frame. */
  draw: (size: Size, paint: (pen: Pen, size: Size) => void) => void
  /** Removes what the painter put on the phone. */
  stop: () => void
}>

// ---------------------------------------------------------------- Skia

const FILL = 0
const STROKE = 1

/** Roughly how far below the top of a line of text its baseline is. */
const BASELINE = 0.8

/**
 * Paints and fonts are native objects. A game uses a handful of colors, so
 * each is made once and kept.
 */
const makeSkiaPen = (host: SkiaHost) => {
  const paints = new Map<string, SkPaint>()
  const fonts = new Map<number, unknown>()
  let typeface: unknown
  let hasNoFont = false
  let canvas: SkCanvas | undefined

  const paintFor = (color: string, stroke: number | undefined): SkPaint => {
    const key = `${color}|${stroke ?? 'fill'}`
    let paint = paints.get(key)
    if (paint === undefined) {
      paint = host.api.Paint()
      paint.setAntiAlias(true)
      paint.setColor(host.api.Color(color))
      paint.setStyle(stroke === undefined ? FILL : STROKE)
      if (stroke !== undefined) paint.setStrokeWidth(stroke)
      paints.set(key, paint)
    }
    return paint
  }

  /** The phone's own font. Skia draws no text without one. */
  const fontFor = (size: number): unknown => {
    if (hasNoFont) return undefined
    let font = fonts.get(size)
    if (font !== undefined) return font
    try {
      typeface ??= host.api.FontMgr?.System().matchFamilyStyle('System', { weight: 400 })
      if (typeface === undefined || typeface === null) {
        hasNoFont = true
        return undefined
      }
      font = host.api.Font(typeface, size)
      fonts.set(size, font)
      return font
    } catch {
      // Text is left out rather than taking the whole drawing down.
      hasNoFont = true
      return undefined
    }
  }

  const pen: Pen = {
    circle: (cx, cy, radius, paint) =>
      canvas?.drawCircle(cx, cy, radius, paintFor(paint.color, paint.stroke)),
    rect: (x, y, width, height, paint) =>
      canvas?.drawRect({ x, y, width, height }, paintFor(paint.color, paint.stroke)),
    line: (x1, y1, x2, y2, paint) =>
      canvas?.drawLine(x1, y1, x2, y2, paintFor(paint.color, paint.stroke ?? 1)),
    text: (value, x, y, paint) => {
      const font = fontFor(paint.size)
      if (font === undefined) return
      canvas?.drawText(value, x, y + paint.size * BASELINE, paintFor(paint.color, undefined), font)
    },
  }

  return {
    pen,
    aim: (at: SkCanvas | undefined): void => {
      canvas = at
    },
  }
}

/**
 * Records each frame as a Skia picture and hands it to the Skia view that
 * has `nativeId`.
 */
export const makeSkiaPainter = (host: SkiaHost, nativeId: number): Painter => {
  const { pen, aim } = makeSkiaPen(host)
  let last: SkPicture | undefined
  let isStopped = false
  return {
    draw: (size, paint) => {
      if (isStopped) return
      const recorder = host.api.PictureRecorder()
      // Without a size yet, Skia records into bounds of its own.
      const canvas =
        size.width > 0 && size.height > 0
          ? recorder.beginRecording({ x: 0, y: 0, width: size.width, height: size.height })
          : recorder.beginRecording()
      aim(canvas)
      try {
        paint(pen, size)
      } finally {
        aim(undefined)
      }
      const picture = recorder.finishRecordingAsPicture()
      host.views.setJsiProperty(nativeId, 'picture', picture)
      host.views.requestRedraw(nativeId)
      // The view keeps its own hold on the picture it was given. Letting go
      // of the one before, and of the recorder, frees them now instead of
      // whenever the garbage collector gets to them: 60 pictures a second
      // would otherwise pile up.
      last?.dispose?.()
      recorder.dispose?.()
      last = picture
    },
    stop: () => {
      if (isStopped) return
      isStopped = true
      host.views.setJsiProperty(nativeId, 'picture', null)
      last?.dispose?.()
      last = undefined
    },
  }
}

// ---------------------------------------------------------- plain views

type Kind = 'circle' | 'rect' | 'line' | 'text'

type Pooled = {
  readonly node: EngineNode
  /** The text inside, for a text view. */
  readonly textNode: EngineNode | undefined
  /** What the view was last given, so an unchanged view is left alone. */
  shown: string
  text: string
}

const HIDDEN = 'hidden'

/**
 * Draws each frame with ordinary views inside `parent`, moved through the
 * engine. The caller commits: one commit sends the whole frame.
 */
export const makeViewPainter = (engine: Engine, parent: EngineNode): Painter => {
  const pools: Record<Kind, Array<Pooled>> = { circle: [], rect: [], line: [], text: [] }
  const used: Record<Kind, number> = { circle: 0, rect: 0, line: 0, text: 0 }
  let isStopped = false

  const take = (kind: Kind): Pooled => {
    const pool = pools[kind]
    const at = used[kind]++
    let pooled = pool[at]
    if (pooled === undefined) {
      const node = engine.createElement(kind === 'text' ? 'text' : 'view')
      // A finger goes through to the canvas under the shapes.
      engine.setProp(node, 'pointerEvents', 'none')
      let textNode: EngineNode | undefined
      if (kind === 'text') {
        textNode = engine.createText('')
        engine.appendChild(node, textNode)
      }
      engine.appendChild(parent, node)
      pooled = { node, textNode, shown: '', text: '' }
      pool.push(pooled)
    }
    return pooled
  }

  const show = (pooled: Pooled, style: Record<string, unknown>): void => {
    const key = JSON.stringify(style)
    if (key === pooled.shown) return
    pooled.shown = key
    engine.setProp(pooled.node, 'style', style)
  }

  /** A box whose top left corner is moved to `x`, `y`. */
  const boxStyle = (x: number, y: number, width: number, height: number, paint: Paint) => ({
    position: 'absolute',
    left: 0,
    top: 0,
    width,
    height,
    ...(paint.stroke === undefined
      ? { backgroundColor: paint.color }
      : { borderWidth: paint.stroke, borderColor: paint.color }),
    transform: [{ translateX: x }, { translateY: y }],
  })

  const pen: Pen = {
    circle: (cx, cy, radius, paint) =>
      show(take('circle'), {
        ...boxStyle(cx - radius, cy - radius, 2 * radius, 2 * radius, paint),
        borderRadius: radius,
      }),
    rect: (x, y, width, height, paint) => show(take('rect'), boxStyle(x, y, width, height, paint)),
    line: (x1, y1, x2, y2, paint) => {
      // A thin box as long as the line, turned about its middle.
      const length = Math.hypot(x2 - x1, y2 - y1)
      const thickness = paint.stroke ?? 1
      show(take('line'), {
        position: 'absolute',
        left: 0,
        top: 0,
        width: length,
        height: thickness,
        backgroundColor: paint.color,
        transform: [
          { translateX: (x1 + x2) / 2 - length / 2 },
          { translateY: (y1 + y2) / 2 - thickness / 2 },
          { rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` },
        ],
      })
    },
    text: (value, x, y, paint) => {
      const pooled = take('text')
      if (pooled.text !== value && pooled.textNode !== undefined) {
        pooled.text = value
        engine.setText(pooled.textNode, value)
      }
      show(pooled, {
        position: 'absolute',
        left: 0,
        top: 0,
        color: paint.color,
        fontSize: paint.size,
        transform: [{ translateX: x }, { translateY: y }],
      })
    },
  }

  const kinds: ReadonlyArray<Kind> = ['circle', 'rect', 'line', 'text']

  return {
    draw: (size, paint) => {
      if (isStopped) return
      for (const kind of kinds) used[kind] = 0
      paint(pen, size)
      // Views the frame did not draw stay in the pool, unseen.
      for (const kind of kinds) {
        const pool = pools[kind]
        for (let at = used[kind]; at < pool.length; at++) {
          const pooled = pool[at] as Pooled
          if (pooled.shown === HIDDEN) continue
          pooled.shown = HIDDEN
          engine.setProp(pooled.node, 'style', { display: 'none' })
        }
      }
    },
    stop: () => {
      if (isStopped) return
      isStopped = true
      for (const kind of kinds) {
        for (const pooled of pools[kind].splice(0)) {
          engine.removeChild(parent, pooled.node)
          engine.destroyNode(pooled.node)
        }
      }
    },
  }
}
