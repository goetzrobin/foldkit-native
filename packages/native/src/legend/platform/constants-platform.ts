/**
 * Legend asks whether it runs on React Native's new architecture (Fabric).
 * This adapter only exists on Fabric: the engine it draws with commits
 * straight to Fabric. So the answer is always yes, and Legend takes the
 * paths it takes there: rows are measured right after a commit, and the
 * native scroll view keeps the visible rows in place.
 */
export const IsNewArchitecture = true
