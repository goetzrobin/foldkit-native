import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { LongList, ROW_COUNT, viewRuns } from '../playground/longList.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const VIEWPORT = 800

describe('long list, way A', () => {
  it('draws a window of the 1,000 rows, not all of them', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(LongList, { hasReadout: false })
        const drawn = NativeTest.flatten(app.fabric.committed).filter(node =>
          String(node.props['testID'] ?? '').startsWith('row-'),
        )
        expect(drawn.length).toBeGreaterThan(5)
        expect(drawn.length).toBeLessThan(40)
        expect(app.has('row-0')).toBe(true)
        expect(app.has(`row-${ROW_COUNT - 1}`)).toBe(false)
        console.log('rows drawn at start', drawn.length, 'native views', app.stats.live)
      }),
    ))

  it('a scroll step inside the margin draws nothing', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(LongList, { hasReadout: false })
        yield* app.scroll('long-list', { y: 0, height: VIEWPORT })
        const runs = { ...viewRuns }
        const commits = app.commitCount()
        yield* app.scroll('long-list', { y: 40, height: VIEWPORT })
        yield* app.scroll('long-list', { y: 80, height: VIEWPORT })
        expect(viewRuns.list - runs.list).toBe(0)
        expect(viewRuns.rows - runs.rows).toBe(0)
        expect(app.commitCount() - commits).toBe(0)
      }),
    ))
})
