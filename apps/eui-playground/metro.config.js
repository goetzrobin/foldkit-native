// Metro's config, plus one step: refresh the app's copy of the shared code
// in ./native before Metro reads it. Every way of starting the app loads this
// file (expo start, expo run:ios, expo run:android, expo export), so the copy
// can never be out of date. Set EUI_SKIP_SYNC=1 to skip it.
if (!process.env.EUI_SKIP_SYNC && !global.__euiSynced) {
  global.__euiSynced = true
  require('child_process').execFileSync(
    'bash',
    [require('path').join(__dirname, '../../scripts/sync-eui-playground.sh')],
    { stdio: 'inherit', cwd: __dirname },
  )
}

const { getDefaultConfig } = require('expo/metro-config')

module.exports = getDefaultConfig(__dirname)
