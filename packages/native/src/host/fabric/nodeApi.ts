/**
 * A view updater changes the screen through a small set of node functions:
 * create an element, insert it, remove it, set its text. In a browser those
 * call the DOM. Here they call ng-native's engine, which turns them into
 * Fabric commits.
 *
 * The functions are named as the DOM names them, because that is what an
 * updater written for the browser expects. Foldkit's binding hands this
 * object to Foldkit's updater (see `src/foldkit/nodeApi.ts`).
 */
import type { Engine, EngineNode } from '@ng-native/fabric'

const clearChildren = (engine: Engine, node: EngineNode): void => {
  for (const child of [...node.childList]) {
    engine.removeChild(node, child as EngineNode)
    engine.destroyNode(child as EngineNode)
  }
}

export const makeEngineNodeApi = (engine: Engine) => ({
    createElement: (tagName: string) => engine.createElement(tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      engine.createElement(tagName),
    createTextNode: (text: string) => engine.createText(text),
    createComment: (_text: string) => engine.createAnchor(),
    insertBefore: (
      parent: EngineNode,
      node: EngineNode,
      reference: EngineNode | null,
    ) => {
      if (reference === null) {
        engine.appendChild(parent, node)
      } else {
        engine.insertBefore(parent, node, reference)
      }
    },
    removeChild: (parent: EngineNode, child: EngineNode) => {
      engine.removeChild(parent, child)
      engine.destroyNode(child)
    },
    appendChild: (parent: EngineNode, child: EngineNode) =>
      engine.appendChild(parent, child),
    parentNode: (node: EngineNode) => engine.parentNode(node),
    nextSibling: (node: EngineNode) => engine.nextSibling(node),
    tagName: (node: EngineNode) => node.tag,
    setTextContent: (node: EngineNode, text: string | null) => {
      if (node.nodeKind === 'text') {
        engine.setText(node, text ?? '')
        return
      }
      clearChildren(engine, node)
      if (text !== null && text !== '') {
        engine.appendChild(node, engine.createText(text))
      }
    },
    getTextContent: (node: EngineNode) => node.nodeText,
    isElement: (node: EngineNode) => node.nodeKind === 'element',
    isText: (node: EngineNode) => node.nodeKind === 'text',
    isComment: (node: EngineNode) => node.nodeKind === 'anchor',
})

export type EngineNodeApi = ReturnType<typeof makeEngineNodeApi>
