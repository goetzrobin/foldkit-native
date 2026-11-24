/**
 * The plain views a menu's trigger and in-app list are drawn in. The names
 * let the menu's behaviour find them.
 */
import { registerViewName } from '@ng-native/fabric'

export const ANCHOR_TAG = 'fk-menu-anchor'
export const LIST_TAG = 'fk-menu-list'
registerViewName(ANCHOR_TAG, 'View')
registerViewName(LIST_TAG, 'View')
