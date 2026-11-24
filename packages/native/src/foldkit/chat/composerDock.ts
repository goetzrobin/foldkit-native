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
 * There are three docks to choose from with `mode`.
 *
 * `'inset'` is the one to use for a chat where the phone can do it (see
 * `chatScroll.ts`): the list keeps its full height, the composer lies over
 * its bottom edge and travels with the keyboard, and the list's scroll view
 * makes room with a bottom inset. Pass the list as `above`, give the list
 * `keyboardInset`, and name it here:
 *
 *   composerDock(h, {
 *     mode: 'inset',
 *     listId: 'messages',
 *     keyboardHeight: model.keyboardHeight,
 *     backgroundColor: '#fff',
 *     above: [list(h, { id: 'messages', keyboardInset: { lift: 'whenAtEnd' }, ... })],
 *     children: [composer],
 *   })
 *
 * Where the phone cannot do it, `'inset'` is `'follow'`.
 *
 * `'simple'` (the default) needs nothing but what Expo Go has, and is the
 * rest of this comment. `'follow'` hands the work to `keyboardDock` in
 * `../keyboard`, which moves the composer with the keyboard frame by frame
 * where the phone supports it. For that one, pass the list as `above`, not
 * as a sibling, so that the dock can move it too:
 *
 *   composerDock(h, {
 *     mode: 'follow',
 *     keyboardHeight: model.keyboardHeight,
 *     backgroundColor: '#fff',
 *     above: [list(h, { ..., attributes: [style({ flex: 1 })] })],
 *     children: [composer],
 *   })
 *
 * The simple dock is kept as it was so that an app always has one that is
 * easy to reason about. It is the only place in this file that knows about
 * the keyboard.
 *
 * How the simple dock works:
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
 * In both modes the list above the dock gets shorter by the height the
 * keyboard covers. That is the only way the list hears of the keyboard: the
 * phone tells it its new height, and a list with `maintainScrollAtEnd` then
 * scrolls to keep its last row in view.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'
import { element } from 'foldkit/renderTarget'

import { prop, style } from '../attributes.js'
import { keyboardDock } from '../keyboard/dock.js'
import { chatInsetAvailable } from '../../host/chat/chatScroll.js'

const el = element<any>()

/**
 * `'inset'`: the composer lies over the list and travels with the keyboard,
 * and the list makes room by scrolling, not by getting shorter.
 * `'follow'`: the composer travels with the keyboard where the phone can do
 * that, and eases to its place where it cannot. `'simple'`: it is padded by
 * the keyboard's height and jumps.
 */
export type ComposerDockMode = 'inset' | 'follow' | 'simple'

export type ComposerDock = Readonly<{
  /**
   * The keyboard's height in points, 0 while it is hidden. Keep it in the
   * Model from `Phone.Keyboard.changesEntry`.
   */
  keyboardHeight: number
  /** The composer. */
  children: ReadonlyArray<Html>
  /**
   * Attributes for the dock itself, such as a top border. Do not pass
   * `paddingBottom`. In `'simple'` mode a background color given here also
   * fills the strip beside the home indicator. In `'follow'` mode they go on
   * a view around the composer alone, so pass the color as `backgroundColor`.
   */
  attributes?: ReadonlyArray<unknown>
  /** Which dock to use. Default `'simple'`. See the top of this file. */
  mode?: ComposerDockMode
  /**
   * What sits above the composer and should keep clear of the keyboard with
   * it: the list of messages, with `style({ flex: 1 })`. With it, the result
   * fills its parent, the content on top and the composer at the bottom.
   * `'follow'` mode needs it to move the list with the keyboard. Without it,
   * the result is the composer alone: put it last in a column.
   */
  above?: ReadonlyArray<Html>
  /** The dock's color, which also fills the strip beside the home indicator. */
  backgroundColor?: string
  /** For `'inset'`: the id of the list in `above`, which has `keyboardInset`. */
  listId?: string
}>

/** Tells the two docks apart when one replaces the other on screen. */
const SIMPLE_KEY = 'composer-dock-simple'

const simpleDock = (config: ComposerDock): Html => {
  const keyboardHeight = Math.max(0, config.keyboardHeight)
  const isKeyboardUp = keyboardHeight > 0
  // Three views, so that no two of them write the same style: the caller's
  // attributes, the keyboard padding, and the phone's own safe area padding.
  const bar = el('view')((config.attributes ?? []) as never, [
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
  // A color of its own goes on a view of its own, for the same reason.
  const colored =
    config.backgroundColor === undefined
      ? bar
      : el('view')([style({ backgroundColor: config.backgroundColor })] as never, [bar])
  if (config.above === undefined) return colored
  const column = el('view')([style({ flex: 1 })] as never, [...config.above, colored] as never)
  if (column !== null) column.key = SIMPLE_KEY
  return column
}

/** A bar at the bottom of the screen that stays above the keyboard. */
export const composerDock = <Message>(
  h: HtmlBuilder<Message>,
  config: ComposerDock,
): Html => {
  if ((config.mode ?? 'simple') === 'simple') return simpleDock(config)
  // `keyboardDock` writes the styles of its own views, so the caller's
  // attributes go on a view inside the bar. The result is returned as it is:
  // a view around it would become the bar's parent on the phone, and the
  // bar only takes touches inside its parent's frame.
  return keyboardDock(h, {
    keyboardHeight: config.keyboardHeight,
    children:
      config.attributes === undefined
        ? config.children
        : [el('view')(config.attributes as never, config.children as never)],
    ...(config.above === undefined ? {} : { above: config.above }),
    ...(config.backgroundColor === undefined ? {} : { backgroundColor: config.backgroundColor }),
    ...(config.mode === 'inset' && config.listId !== undefined && chatInsetAvailable()
      ? { inset: { listId: config.listId } }
      : {}),
  })
}
