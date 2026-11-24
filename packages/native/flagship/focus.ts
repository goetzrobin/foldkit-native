/**
 * Puts the cursor in a text field from a Command, by a name the field is
 * given in the view.
 *
 *   textInput([fieldName('draft'), ...], [])
 *   execute: focusField('draft').pipe(Effect.as(Message.CompletedSideEffect()))
 *
 * Fold Chat used the field's own `autoFocus` to raise the keyboard in a new
 * chat. The phone acts on that the moment the field is put on screen,
 * which is in the middle of the push, before the composer has been
 * measured and before react-native-keyboard-controller knows the
 * composer's height for its drag. On the owner's iPhone the keyboard came
 * up, went down and came up again. A Command sent once the push has
 * finished raises it once, on a screen that has settled.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { Effect } from 'effect'
import type { VNode } from 'foldkit/renderTarget'

import { prop } from '../src/foldkit/attributes.js'
import { type ModuleFactory, registerModule } from '../src/foldkit/extend.js'
import { bagOf, nodeOf } from '../src/host/fabric/nodes.js'

const NAME = 'flagshipFieldName'

type Field = Readonly<{ engine: Engine; node: EngineNode }>

const fields = new Map<string, Field>()

/** Names a text field, for `focusField`. One field on screen per name. */
export const fieldName = (name: string) => prop(NAME, name)

/** Puts the cursor in the named field, if it is on screen and not focused yet. */
export const focusField = (name: string): Effect.Effect<void> =>
  Effect.sync(() => {
    const field = fields.get(name)
    if (field === undefined || field.engine.focused === field.node) return
    field.engine.focus(field.node)
  })

const focusModule: ModuleFactory = (engine: Engine) => {
  const names = new WeakMap<EngineNode, string>()

  const forget = (node: EngineNode): void => {
    const name = names.get(node)
    if (name === undefined) return
    names.delete(node)
    if (fields.get(name)?.node === node) fields.delete(name)
  }

  const sync = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const name = bagOf(vnode, 'props')[NAME]
    if (typeof name !== 'string') {
      forget(node)
      return
    }
    if (names.get(node) !== name) forget(node)
    names.set(node, name)
    fields.set(name, { engine, node })
  }

  return {
    create: (_empty: VNode, vnode: VNode) => sync(vnode),
    update: (_old: VNode, vnode: VNode) => sync(vnode),
    destroy: (vnode: VNode) => {
      const node = nodeOf(vnode)
      if (node !== undefined) forget(node)
    },
  }
}

registerModule(focusModule)
