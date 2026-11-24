// Metro's config, plus one step: compile the app's Tailwind classes into a
// stylesheet module the engine can read (.foldkit-native/tailwind.js).
//
// `withTailwind` comes from ng-native. It needs none of ng-native's Angular
// compiler: it runs the Tailwind CLI, compiles the CSS with ng-native's CSS
// compiler, writes the module, and hands the Metro config back unchanged.
// While `expo start` runs it also keeps the module up to date as classes are
// written. `node metro.config.js` builds the module once, for a typecheck.
const { getDefaultConfig } = require('expo/metro-config')
const { withTailwind } = require('@ng-native/tailwind/config.cjs')

module.exports = withTailwind(getDefaultConfig(__dirname), {
  input: './styles.css',
  output: './.foldkit-native/tailwind.js',
})
