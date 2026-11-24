// Metro's config, plus one step: compile the app's Tailwind classes into a
// stylesheet module the engine can read (.foldkit-native/tailwind.js).
//
// `withTailwind` comes from ng-native. It needs none of ng-native's Angular
// compiler: it runs the Tailwind CLI, compiles the CSS with ng-native's CSS
// compiler, writes the module, and hands the Metro config back unchanged.
// While `expo start` runs it also keeps the module up to date as classes are
// written. `node metro.config.js` builds the module once, for a typecheck.
// Refresh the app's copy of the shared code in ./native before Metro reads
// it. Every way of starting the app loads this file (expo start, expo run:ios,
// expo run:android, expo export), so the copy can never be out of date.
// Set FOLDKIT_SKIP_SYNC=1 to skip it.
if (!process.env.FOLDKIT_SKIP_SYNC && !global.__foldkitSynced) {
  global.__foldkitSynced = true
  require('child_process').execFileSync(
    'bash',
    [require('path').join(__dirname, '../../scripts/sync-showcase.sh')],
    { stdio: 'inherit', cwd: __dirname },
  )
}

const { getDefaultConfig } = require('expo/metro-config')
const { withTailwind } = require('@ng-native/tailwind/config.cjs')

module.exports = withTailwind(getDefaultConfig(__dirname), {
  input: './styles.css',
  output: './.foldkit-native/tailwind.js',
})
