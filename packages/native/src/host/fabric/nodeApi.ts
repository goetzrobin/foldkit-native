/**
 * Foldkit's updater changes the screen through a small set of node functions.
 * In a browser those call the DOM. Here they call ng-native's engine, which
 * turns them into Fabric commits.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import type { DOMAPI } from 'foldkit/renderTarget'

const clearChildren = (engine: Engine, node: EngineNode): void => {
  for (const child of [...node.childList]) {
    engine.removeChild(node, child as EngineNode)
    engine.destroyNode(child as EngineNode)
  }
}

export const makeNodeApi = (engine: Engine): DOMAPI => {
  const api = {
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
  }
  // The updater is typed against browser nodes. The engine's nodes stand in
  // for them here, and nothing outside this file sees the difference.
  return api as unknown as DOMAPI
}
