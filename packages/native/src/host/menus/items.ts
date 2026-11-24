/**
 * What a menu holds, as plain data, and the few ways it is rewritten for
 * the different things that draw it.
 *
 *   const items: ReadonlyArray<MenuItem> = [
 *     { key: 'copy', title: 'Copy', symbol: 'doc.on.doc' },
 *     { key: 'pin', title: 'Pinned', isChecked: model.isPinned },
 *     { title: 'Move to', symbol: 'folder', submenu: [
 *       { key: 'move-inbox', title: 'Inbox' },
 *       { key: 'move-archive', title: 'Archive' },
 *     ] },
 *     { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
 *   ]
 *
 * An action has a `key`. The key comes back when the user chooses it, so it
 * must be unique within the menu. A `section` is a group set apart by a
 * line. A `submenu` opens a second menu, one level deep.
 */

/** One thing to choose. */
export type MenuAction = Readonly<{
  /** Comes back when the user chooses this. Unique within the menu. */
  key: string
  title: string
  /** iOS: an SF Symbol name, such as `trash`. Android menus show no icons here. */
  symbol?: string
  /** Red on iOS and Android: for deleting and the like. */
  isDestructive?: boolean
  /** Greyed out, and cannot be chosen. */
  isDisabled?: boolean
  /** `true` shows a check mark. `false` or left out shows none. */
  isChecked?: boolean
}>

/** A second menu that opens from an entry of the first. */
export type MenuSubmenu = Readonly<{
  title: string
  symbol?: string
  submenu: ReadonlyArray<MenuAction>
}>

/** A group of entries set apart from the rest, with an optional heading. */
export type MenuSection = Readonly<{
  title?: string
  section: ReadonlyArray<MenuAction | MenuSubmenu>
}>

export type MenuItem = MenuAction | MenuSubmenu | MenuSection

export const isSection = (item: MenuItem): item is MenuSection => 'section' in item
export const isSubmenu = (item: MenuItem): item is MenuSubmenu => 'submenu' in item

/** An action as one line of a flat list. */
export type FlatAction = Readonly<{
  key: string
  /** A submenu's entries carry the submenu's title: "Move to: Inbox". */
  title: string
  isDestructive: boolean
  isDisabled: boolean
  isChecked: boolean
  /** The first line of a section after the first. Drawn with a line above. */
  startsSection: boolean
}>

/**
 * The menu as one flat list, for what cannot draw sections and submenus: an
 * action sheet, a dialog with a list, the in-app list.
 */
export const flatten = (items: ReadonlyArray<MenuItem>): ReadonlyArray<FlatAction> => {
  const flat: Array<FlatAction> = []
  let startsSection = false
  const add = (action: MenuAction, prefix: string): void => {
    flat.push({
      key: action.key,
      title: prefix + action.title,
      isDestructive: action.isDestructive === true,
      isDisabled: action.isDisabled === true,
      isChecked: action.isChecked === true,
      startsSection: startsSection && flat.length > 0,
    })
    startsSection = false
  }
  const addEntry = (entry: MenuAction | MenuSubmenu): void => {
    if (isSubmenu(entry)) for (const action of entry.submenu) add(action, `${entry.title}: `)
    else add(entry, '')
  }
  for (const item of items) {
    if (isSection(item)) {
      startsSection = true
      for (const entry of item.section) addEntry(entry)
      startsSection = true
    } else {
      addEntry(item)
    }
  }
  return flat
}

/** What an action reads as in a list that has no check marks of its own. */
export const checkedTitle = (action: Readonly<{ title: string; isChecked: boolean }>): string =>
  action.isChecked ? `✓ ${action.title}` : action.title

// THE TITLE BAR (iOS)

const barAction = (action: MenuAction): Record<string, unknown> => {
  const data: Record<string, unknown> = { type: 'action', menuId: action.key, title: action.title }
  if (action.symbol !== undefined) data['sfSymbolName'] = action.symbol
  if (action.isChecked !== undefined) data['state'] = action.isChecked ? 'on' : 'off'
  if (action.isDisabled === true) data['disabled'] = true
  if (action.isDestructive === true) data['destructive'] = true
  return data
}

const barEntry = (entry: MenuAction | MenuSubmenu): Record<string, unknown> => {
  if (!isSubmenu(entry)) return barAction(entry)
  const data: Record<string, unknown> = {
    type: 'submenu',
    title: entry.title,
    items: entry.submenu.map(barAction),
  }
  if (entry.symbol !== undefined) data['sfSymbolName'] = entry.symbol
  return data
}

/**
 * The menu as react-native-screens reads it on a title bar button (see its
 * `RNSBarButtonItem.mm`): an entry with a `menuId` is an action, and one
 * without is a menu inside the menu. A section is such an inner menu shown
 * in line.
 */
export const barMenuData = (
  menu: Readonly<{ title?: string; items: ReadonlyArray<MenuItem> }>,
): Record<string, unknown> => ({
  ...(menu.title === undefined ? {} : { title: menu.title }),
  items: menu.items.map(item =>
    isSection(item)
      ? {
          type: 'submenu',
          title: item.title ?? '',
          displayInline: true,
          items: item.section.map(barEntry),
        }
      : barEntry(item),
  ),
})
