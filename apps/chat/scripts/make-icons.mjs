// Draws Fold Chat's app icon and splash pictures as PNG files, with no
// packages: plain arithmetic per pixel, then Node's zlib for the PNG.
//
// The mark is a rounded square with its top right corner folded over. It is
// drawn, not copied from anywhere. Run from apps/chat:
//
//   node scripts/make-icons.mjs
//
// Writes assets/icon.png (iOS and the store), assets/adaptive-icon.png
// (Android's foreground layer), assets/splash-light.png and
// assets/splash-dark.png.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const INK = [13, 13, 14]
const WHITE = [255, 255, 255]
const FLAP_ON_INK = [186, 186, 192]
const FLAP_ON_WHITE = [142, 142, 147]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = bytes => {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
const png = (size, rgba) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Inside a rounded square of side `s` and corner radius `r`, at local (u, v). */
const inRounded = (u, v, s, r) => {
  if (u < 0 || v < 0 || u > s || v > s) return false
  const cx = u < r ? r : u > s - r ? s - r : u
  const cy = v < r ? r : v > s - r ? s - r : v
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
}

/**
 * What the mark paints at local (u, v): 'sheet', 'flap' or nothing. The
 * fold cuts the top right corner along a diagonal and the flap is that
 * corner turned over, lying inside the square.
 */
const markAt = (u, v, s, r, f) => {
  if (!inRounded(u, v, s, r)) return null
  const fromCorner = s - u + v
  if (u >= s - f && v <= f) {
    if (fromCorner < f) return null
    return 'flap'
  }
  return 'sheet'
}

/**
 * Draws one picture. `background` null leaves it see-through. The mark is
 * `markSide` wide, centred. Each pixel is sampled 4 x 4 times for smooth edges.
 */
const draw = ({ size, background, sheet, flap, markSide }) => {
  const rgba = Buffer.alloc(size * size * 4)
  const s = markSide
  const r = s * 0.2
  const f = s * 0.34
  const origin = (size - s) / 2
  const samples = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = x + (sx + 0.5) / samples - origin
          const v = y + (sy + 0.5) / samples - origin
          const part = markAt(u, v, s, r, f)
          const color = part === 'sheet' ? sheet : part === 'flap' ? flap : background
          if (color === null) continue
          red += color[0]
          green += color[1]
          blue += color[2]
          alpha += 1
        }
      }
      const at = (y * size + x) * 4
      if (alpha === 0) continue
      rgba[at] = Math.round(red / alpha)
      rgba[at + 1] = Math.round(green / alpha)
      rgba[at + 2] = Math.round(blue / alpha)
      rgba[at + 3] = Math.round((alpha / (samples * samples)) * 255)
    }
  }
  return png(size, rgba)
}

const out = name => new URL(`../assets/${name}`, import.meta.url)

writeFileSync(out('icon.png'), draw({ size: 1024, background: INK, sheet: WHITE, flap: FLAP_ON_INK, markSide: 500 }))
// Android crops the foreground layer to a circle or a squircle, so the mark
// is kept well inside the middle two thirds.
writeFileSync(out('adaptive-icon.png'), draw({ size: 1024, background: null, sheet: WHITE, flap: FLAP_ON_INK, markSide: 420 }))
writeFileSync(out('splash-light.png'), draw({ size: 400, background: null, sheet: INK, flap: FLAP_ON_WHITE, markSide: 400 }))
writeFileSync(out('splash-dark.png'), draw({ size: 400, background: null, sheet: WHITE, flap: FLAP_ON_INK, markSide: 400 }))
console.log('Wrote assets/icon.png, adaptive-icon.png, splash-light.png, splash-dark.png')
