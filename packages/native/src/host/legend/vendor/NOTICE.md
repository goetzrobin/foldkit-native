# Legend List, vendored

Everything in this folder comes from **Legend List** version 3.7.3
(commit `b8014a0`, https://github.com/LegendApp/legend-list), copyright
Moo.do LLC, under the MIT licence in `LICENSE` beside this file.

It is Legend's own arithmetic for a virtualised list: which rows are in view,
which container draws which row, where each container sits, how the scroll
position is held when rows change size, how a list starts and stays at its
end. None of it uses React. Legend's React components, hooks and its
React Native shims are **not** here. `../driver.ts` and `../platform/` are our
own replacements for those.

## How the files got here

`scripts/vendor-legend.mjs` (at the repository root) copied them. It follows
the imports from the functions our driver calls and copies every file it
reaches. `FILES.txt` lists each one with its path in Legend's repository.

## What was changed

In every file, by the script, and nothing else:

1. **Import paths.** Legend writes `@/core/x`, an alias only its own build
   understands. Each became a relative path with no file ending
   (`../core/x`), which Metro, Vite and TypeScript resolve with no
   configuration.
2. **Imports of `react`, `@/platform/*` and `@/constants-platform`** point at
   our files in `../platform/`. (`platform/platform-types.ts` and
   `platform/scrollview-types.ts` are type-only and are Legend's own.)

In single files:

| File | Change |
|---|---|
| `core/doScrollTo.ts` | Legend's `doScrollTo.native.ts`, copied under the plain name. Content unchanged. |
| `core/measureContainersInLayoutEffect.ts` | Legend's `.native.ts` file under the plain name. Content unchanged. |
| `utils/isInMVCPActiveMode.ts` | Legend's `.native.ts` file under the plain name. Content unchanged. |
| `core/ScheduledWork.ts`, `core/bootstrapInitialScroll.ts`, `core/doInitialAllocateContainers.ts`, `core/finishInitialScroll.ts`, `core/initialScrollLifecycle.ts`, `core/nativeScrollToStart.ts`, `utils/requestAdjust.ts` | One import line added at the top, so `requestAnimationFrame` comes from `../platform/frame.ts` and not from a browser global. Marked `// foldkit-native:`. |
| `utils/getRenderedItem.ts` | `import type React from` became `import type * as React from`. Type-only. |
| `state/state.ts` | Legend's `state/state.tsx` with its React half removed, by hand. Kept unchanged: the types, `listen$`, `peek$`, `set$`, `listenPosition$`, `notifyPosition$`. Removed: the React context, `StateProvider`, `useStateContext`, `useArr$`, `useSelector$` and their helpers. Added: `createStateContext()`, which returns the object `StateProvider` built. `animatedScrollY` is left `undefined` (it is React Native's `Animated.Value`, used only by sticky headers). Each change is marked `// foldkit-native:`. |

No function body in `core/` or `utils/` was edited.

## Not vendored

`src/components/*`, `src/hooks/*`, `src/integrations/*`, `src/section-list/*`,
the entry points, `state/ContextContainer.ts` (React hooks for rows) and every `platform/*` file
except the two type files.
