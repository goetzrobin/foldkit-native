/**
 * The rich text view of react-native-enriched-markdown, by tag. Its name is
 * the same on both platforms and needs nothing from Expo. Named at import
 * time; where the build lacks the view, `markdown` never draws this element.
 */
import { registerViewName } from '@ng-native/fabric'

import { NATIVE_MARKDOWN_VIEW } from './detect.js'

/** The element name the engine knows the native view by. */
export const NATIVE_MARKDOWN_TAG = 'enriched-markdown'

registerViewName(NATIVE_MARKDOWN_TAG, { ios: NATIVE_MARKDOWN_VIEW, android: NATIVE_MARKDOWN_VIEW })
