/**
 * Parts for a chat screen. The list behaviour a chat needs (open at the end,
 * stay at the end, room for a streamed reply) is in `../list`.
 */
export { composerDock } from './composerDock.js'
export type { ComposerDock, ComposerDockMode } from './composerDock.js'
export { chatSafeArea } from './safeArea.js'
export { chatInsetAvailable, chatInsetFallbackReason } from '../../host/chat/chatScroll.js'
export type { KeyboardLiftBehavior } from '../../host/chat/vendor/kbc/types.js'
