/**
 * The safe area for a screen that ends in a `composerDock`.
 *
 * `safeArea` from the navigation code keeps content clear of all four edges.
 * A chat screen must not do that at the bottom: the dock pads the bottom
 * itself, by the home indicator or by the keyboard, never both. So this is
 * the same view with the bottom edge left alone.
 */
import type { Html } from 'foldkit/html'
import { element } from 'foldkit/renderTarget'

import { prop } from '../attributes.js'
import type { Device } from '../navigation/stack.js'

const el = element<any>()

export const chatSafeArea = (
  device: Device,
  options: Readonly<{ hasHeader: boolean }>,
  children: ReadonlyArray<Html>,
): Html => {
  // As in `safeArea`: Android already starts a screen below its title bar.
  const isTopTaken = options.hasHeader && device.platform === 'android'
  return el('screen-safe-area')(
    [prop('edges', { top: !isTopTaken, right: true, bottom: false, left: true })],
    children as never,
  )
}
