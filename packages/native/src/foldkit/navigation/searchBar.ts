/**
 * The navigation bar's own search field, under a large title, as in Mail
 * and Notes. iOS only: on Android draw a text field of your own.
 *
 *   registerSearchBar()        once at startup, after registerNavigation()
 *
 *   header([title('Chats'), largeTitle(true)], [
 *     searchBar(h, {
 *       placeholder: 'Search',
 *       onChange: text => Message.ChangedQuery({ text }),
 *     }),
 *   ])
 *
 * It is react-native-screens' `RNSSearchBar` (the phone's
 * UISearchController), placed in the header's `searchBar` slot as
 * react-native-screens' own wrapper places it. None of its JavaScript is
 * used. The text lives in the field; the Model hears each change.
 *
 * The prop and event names are react-native-screens 4.30's
 * (`src/fabric/SearchBarNativeComponent.ts`). The slot is the one ng-native's
 * router uses (`packages/router/src/native-search-bar.ts`). Not seen on a
 * phone yet.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, element } from 'foldkit/renderTarget'

import { SEARCH_BAR, registerSearchBar } from '../../host/navigation/views.js'
import { prop } from '../attributes.js'

const el = element<any>()

export { registerSearchBar }

export type SearchBarOptions<Message> = Readonly<{
  placeholder?: string
  /** Every change of the text, typed or cleared. */
  onChange: (text: string) => Message
  /** The Cancel button. The field empties itself; `onChange` reports it too. */
  onCancel?: () => Message
  /** Scroll the field away with the list, as iOS lists do. On unless said. */
  hidesWhenScrolling?: boolean
  /** The word on the Cancel button. */
  cancelLabel?: string
  testID?: string
}>

/** The search field, for a `header`'s children. See the top of this file. */
export const searchBar = <Message>(_h: HtmlBuilder<Message>, options: SearchBarOptions<Message>): Html =>
  el('native-header-item')(
    [prop('type', 'searchBar')] as never,
    [
      el(SEARCH_BAR)(
        [
          ...(options.testID === undefined ? [] : [prop('testID', options.testID)]),
          ...(options.placeholder === undefined ? [] : [prop('placeholder', options.placeholder)]),
          ...(options.cancelLabel === undefined ? [] : [prop('cancelButtonText', options.cancelLabel)]),
          prop('hideWhenScrolling', options.hidesWhenScrolling ?? true),
          // Under the large title. `automatic` lets iOS 26 move the field
          // into a toolbar, which a stack screen here does not have.
          prop('placement', 'stacked'),
          prop('allowToolbarIntegration', false),
          prop('autoCapitalize', 'none'),
          OnCustomEvent<Message>({
            name: 'changeText',
            f: event => {
              const value = (event.detail as { text?: unknown } | undefined)?.text
              return Option.some(options.onChange(typeof value === 'string' ? value : ''))
            },
          }),
          ...(options.onCancel === undefined
            ? []
            : [
                OnCustomEvent<Message>({
                  name: 'cancelButtonPress',
                  f: () => Option.some((options.onCancel as () => Message)()),
                }),
              ]),
        ] as never,
        [],
      ),
    ],
  )
