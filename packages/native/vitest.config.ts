import { defineConfig } from 'vitest/config'

// Paths to the two source checkouts these tests run against:
//   FOLDKIT_DIR    the Foldkit fork, with the render-target patch applied
//   NG_NATIVE_DIR  ng-native at v0.25.0
const foldkit = `${process.env.FOLDKIT_DIR ?? '../../../foldkit'}/packages/foldkit`
const ngNative = `${process.env.NG_NATIVE_DIR ?? '../../../ng-native'}/packages`

export default defineConfig({
  resolve: {
    // Foldkit and the adapter must share one copy of Effect.
    dedupe: ['effect', '@effect/platform-browser'],
    alias: [
      { find: /^foldkit$/, replacement: `${foldkit}/src/index.ts` },
      { find: /^foldkit\/(.+)$/, replacement: `${foldkit}/src/$1/public.ts` },
      // FABRIC_ENTRY points the tests at a built copy of the engine, such as the
      // one an app installs from npm, in place of the source checkout.
      {
        find: /^@ng-native\/fabric$/,
        replacement: process.env.FABRIC_ENTRY ?? `${ngNative}/fabric/src/index.ts`,
      },
      { find: /^@ng-native\/testing\/fake$/, replacement: `${ngNative}/testing/src/test-utils.ts` },
    ],
  },
  test: {
    // No browser and no DOM stand-in: if Foldkit's runtime reaches for one,
    // the test fails and names it.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
