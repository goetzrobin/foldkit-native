/**
 * The words a swipe row is described with (`src/host/swipe/types.ts`), with
 * passive content drawn as Foldkit `Html`.
 */
import type { Html } from 'foldkit/html'

import type * as Host from '../../host/swipe/types.js'

export * from '../../host/swipe/types.js'

export type SwipeSideOption<Message> = Host.SwipeSideOption<Message, Html>
export type SwipeSideSpec<Message> = Host.SwipeSideSpec<Message, Html>
export type SwipeRowOptions<Message> = Host.SwipeRowOptions<Message, Html>
export type SwipeRowSpec<Message> = Host.SwipeRowSpec<Message, Html>
