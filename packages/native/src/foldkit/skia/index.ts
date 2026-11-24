/**
 * Drawing with Skia, with no React.
 *
 *   registerSkia()                 once at startup: names Skia's native view
 *   configureSkia({ nativeModule }) optional: how to find Skia's native module
 *   canvas(h, { id, scene, props }) a box a scene draws into, frame by frame
 *   isSkiaAvailable()              whether this build has Skia's native code
 *
 * `host.ts` explains how Skia is reached, `draw.ts` the pen and its two
 * renderers (Skia, and plain views where Skia is missing), and `canvas.ts`
 * what a scene is.
 */
export { canvas, registerSkia, rendererFor } from './canvas.js'
export type { CanvasConfig, CanvasSurface, Renderer, Scene, SceneRun } from './canvas.js'
export type { Paint, Pen, Size, TextPaint } from './draw.js'
export {
  configureSkia,
  isSkiaAvailable,
  resetSkia,
  skiaHost,
  skiaUnavailableReason,
} from './host.js'
export type { SkiaApi, SkiaHost, SkiaOptions, SkiaViewApi } from './host.js'
