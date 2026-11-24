/**
 * The engine's node functions (`src/host/fabric/nodeApi.ts`), typed as the
 * DOM node API Foldkit's updater is written against.
 */
import type { Engine } from '@ng-native/fabric'
import type { DOMAPI } from 'foldkit/renderTarget'

import { makeEngineNodeApi } from '../host/fabric/nodeApi.js'

// The updater is typed against browser nodes. The engine's nodes stand in
// for them here, and nothing outside the binding sees the difference.
export const makeNodeApi = (engine: Engine): DOMAPI => makeEngineNodeApi(engine) as unknown as DOMAPI
