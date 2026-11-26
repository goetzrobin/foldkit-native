import { defineConfig } from 'vitest/config'

// The tests run ng-native's engine from a source checkout, on its fake Fabric:
//   NG_NATIVE_DIR  ng-native (the same checkout packages/native tests use)
//   FABRIC_ENTRY   optional: a built engine instead, such as the 0.25.0 the
//                  apps install (node_modules/@ng-native/fabric/dist/index.js)
const ngNative = `${process.env.NG_NATIVE_DIR ?? '../../../ng-native'}/packages`

export default defineConfig({
  resolve: {
    // The host layer in packages/native and this package must share one Effect.
    dedupe: ['effect', '@effect/ui'],
    alias: [
      {
        find: /^@ng-native\/fabric$/,
        replacement: process.env.FABRIC_ENTRY ?? `${ngNative}/fabric/src/index.ts`,
      },
      { find: /^@ng-native\/testing\/fake$/, replacement: `${ngNative}/testing/src/test-utils.ts` },
    ],
  },
  test: {
    // Plain Node: no DOM, no requestAnimationFrame. A browser global fails the test.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
