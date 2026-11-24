/** React Native's own switch, by tag: `Switch` on iOS, `AndroidSwitch` on Android. */
import { registerViewName } from '@ng-native/fabric'

export const RN_SWITCH_TAG = 'fk-rn-switch'
registerViewName(RN_SWITCH_TAG, { ios: 'Switch', android: 'AndroidSwitch' })
