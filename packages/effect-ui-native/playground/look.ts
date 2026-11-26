/**
 * The playground's plain look: a few colours and shared styles. No design
 * here on purpose. The screens exist to answer questions, not to look good.
 */
import type { Native } from '../src/index.js'

export const INK = '#111111'
export const DIM = '#6B6B6B'
export const LINE = '#DDDDDD'
export const PAPER = '#FFFFFF'
export const WASH = '#F3F3F3'
export const BLUE = '#0A60FF'
export const RED = '#C62828'

export const page: Native.ViewStyle = { flex: 1, backgroundColor: PAPER }
export const pad: Native.ViewStyle = { padding: 16, gap: 12 }

export const label: Native.TextStyle = { fontSize: 16, color: INK }
export const small: Native.TextStyle = { fontSize: 13, color: DIM }
export const big: Native.TextStyle = { fontSize: 48, color: INK, fontWeight: '600' }

export const button: Native.ViewStyle = {
  paddingVertical: 12,
  paddingHorizontal: 16,
  borderRadius: 8,
  backgroundColor: BLUE,
  alignItems: 'center',
}
export const buttonPressed: Native.ViewStyle = { opacity: 0.5 }
export const buttonText: Native.TextStyle = { fontSize: 16, color: PAPER, fontWeight: '600' }

export const row: Native.ViewStyle = {
  paddingVertical: 12,
  paddingHorizontal: 16,
  borderBottomWidth: 1,
  borderBottomColor: LINE,
  backgroundColor: PAPER,
}
export const rowPressed: Native.ViewStyle = { backgroundColor: WASH }

/** A plain button: a pressable box with a word in it. */
export const plainButton = <Msg>(h: Native.H<Msg>, id: string, text: string, message: Msg) =>
  h.pressable
    .testId(id)
    .style(button)
    .pressedStyle(buttonPressed)
    .on('press', message)
    .children(h.text.style(buttonText).children(text))
