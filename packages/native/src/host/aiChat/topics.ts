/**
 * The sync topics of AI chat, for the atoms client (`client.ts`). They are
 * in a file of their own so that the wire (`wire.ts`) names no way of
 * keeping server data: a program that uses something else never loads this.
 */
import { makeSync } from '../serverState/sync.js'

/**
 * Announced by the client after its own writes. `conversation-list-changed`:
 * a conversation was made, renamed, deleted, or got a new message (its
 * preview and time changed). `conversation-changed`: the messages of a
 * conversation changed. One topic for every conversation: only the open one
 * is being watched, so only it loads again.
 */
export const AiChatSync = makeSync([
  'chat:conversation-list-changed',
  'chat:conversation-changed',
])
export type AiChatTopic = (typeof AiChatSync.topics)[number]
