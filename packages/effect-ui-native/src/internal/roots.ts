/**
 * Who wants to know about each mounted tree.
 *
 * `NativeHost.mountEffect` tells this service about every tree it mounts and
 * again when the tree is taken away. By default nobody listens. The dev
 * tools Layer (`NativeDevTools.layer`) provides its own, so the dev tools
 * server can send Messages into the running app.
 */
import type * as Renderer from '@effect/ui/Renderer'
import * as Context from 'effect/Context'

export interface Roots {
  /** Called with a mounted tree. Returns the function that forgets it. */
  readonly register: (root: Renderer.Root<any, any>) => () => void
}

const forget = (): void => {}
const nobody: Roots = { register: () => forget }

export const Roots: Context.Reference<Roots> = Context.Reference<Roots>('effect-ui-native/Roots', {
  defaultValue: () => nobody,
})
