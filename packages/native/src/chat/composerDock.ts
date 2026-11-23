/**
 * Keeps a chat's composer (the text field and Send button) on top of the
 * keyboard.
 *
 *   box([style({ flex: 1 })], [
 *     list(h, { ...,  attributes: [style({ flex: 1 })] }),
 *     composerDock(h, {
 *       keyboardHeight: model.keyboardHeight,
 *       attributes: [style({ backgroundColor: '#fff' })],
 *       children: [composer],
 *     }),
 *   ])
 *
 * Put it last in a column whose bottom edge is the bottom of the screen, and
 * wrap that column in `chatSafeArea` (see `safeArea.ts`), not `safeArea`:
 * the dock deals with the bottom of the screen itself.
 *
 * THIS FILE IS A PLACEHOLDER FOR A BETTER DOCK. It is the one place in the
 * chat code that knows about the keyboard, so that the frame-by-frame dock
 * being built in `src/keyboard/` can replace the body of `composerDock`
 * without the demos changing.
 *
 * How it works today, with nothing but what Expo Go has:
 *
 * - Keyboard down: the composer is padded clear of the home indicator by the
 *   phone's own safe area view.
 * - Keyboard up: that padding is switched off and the dock is padded by the
 *   keyboard's height instead. The keyboard covers the home indicator, so the
 *   two must not be added together.
 *
 * The height comes from `Phone.Keyboard` through the Model. iOS reports it as
 * the keyboard starts to move, so the composer jumps to its place while the
 * keyboard is still sliding. It does not travel with the keyboard, and it does
 * not follow a finger that drags the keyboard down.
 *
 * The list above the dock gets shorter by the same amount. A list with
 * `maintainScrollAtEnd` then scrolls to keep its last row in view.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'
import { element } from 'foldkit/renderTarget'

import { prop, style } from '../attributes.js'

const el = element<any>()

export type ComposerDock = Readonly<{
  /**
   * The keyboard's height in points, 0 while it is hidden. Keep it in the
   * Model from `Phone.Keyboard.changesEntry`.
   */
  keyboardHeight: number
  /** The composer. */
  children: ReadonlyArray<Html>
  /**
   * Attributes for the dock itself, such as a background color, which then
   * also fills the strip beside the home indicator. Do not pass `paddingBottom`.
   */
  attributes?: ReadonlyArray<unknown>
}>

/** A bar at the bottom of the screen that stays above the keyboard. */
export const composerDock = <Message>(
  _h: HtmlBuilder<Message>,
  config: ComposerDock,
): Html => {
  const keyboardHeight = Math.max(0, config.keyboardHeight)
  const isKeyboardUp = keyboardHeight > 0
  // Three views, so that no two of them write the same style: the caller's
  // attributes, the keyboard padding, and the phone's own safe area padding.
  return el('view')((config.attributes ?? []) as never, [
    el('view')(
      [style({ paddingBottom: keyboardHeight })] as never,
      [
        // The phone's safe area view, for the bottom edge only.
        el('screen-safe-area')(
          [
            prop('edges', { top: false, right: false, bottom: !isKeyboardUp, left: false }),
            // The view fills its parent unless told otherwise. A dock is
            // only as tall as the composer.
            style({ flex: 0 }),
          ] as never,
          config.children as never,
        ),
      ],
    ),
  ])
}
