/**
 * What every sheet of Fold Chat is made of: the phone's own bottom sheet as
 * a screen of the stack (src/navigation/sheets.ts), and a title with an
 * optional button. A swipe down closes a sheet and sends its `onClosed`.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { prop, pressedStyle, style } from '../src/foldkit/attributes.js'
import { text, view } from '../src/foldkit/elements.js'
import { sheet } from '../src/foldkit/navigation/sheets.js'
import { type Device, modalScreen, onDismissed } from '../src/foldkit/navigation/stack.js'
import { type Palette, SPACE, TYPE } from './theme.js'

export const sheetTitle = <Message>(
  h: HtmlBuilder<Message>,
  palette: Palette,
  title: string,
  action?: Readonly<{ id: string; label: string; message: Message }>,
): Html =>
  view(
    [
      prop('collapsable', false),
      style({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.xl, paddingTop: SPACE.xl, paddingBottom: SPACE.m }),
    ],
    [
      text([prop('accessibilityRole', 'header'), style({ fontSize: 20, lineHeight: 25, fontWeight: '600', color: palette.ink, flexShrink: 1 })], [title]),
      ...(action === undefined
        ? []
        : [
            view(
              [h.Key(action.id), prop('testID', action.id), prop('accessibilityRole', 'button'), h.OnClick(action.message), pressedStyle({ opacity: 0.5 }), prop('hitSlop', { top: 10, bottom: 10, left: 10, right: 10 })],
              [text([style({ ...TYPE.button, color: palette.ink })], [action.label])],
            ),
          ]),
    ],
  )

/** A sheet as a screen of the stack: `sheet-<name>`, at these heights. */
export const sheetScreen = <Message>(
  h: HtmlBuilder<Message>,
  device: Device,
  palette: Palette,
  name: string,
  detents: ReadonlyArray<number> | 'fit',
  onClosed: Message,
  children: ReadonlyArray<Html>,
): Html =>
  modalScreen(
    [
      h.Key(`sheet-${name}`),
      prop('testID', `sheet-${name}`),
      onDismissed(() => onClosed),
      ...sheet<Message>({ device, detents, hasGrabber: true, background: palette.bg }),
    ] as never,
    children,
  )
