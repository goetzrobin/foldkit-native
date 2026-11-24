/**
 * Which phone this is, as ng-native's engine was told: `ios`, `android`, or
 * `unknown` before the app has said (and in a test that never does).
 */
import { nativePlatform } from '@ng-native/fabric'

export const platformName = (): string => {
  try {
    return String(nativePlatform())
  } catch {
    return 'unknown'
  }
}
