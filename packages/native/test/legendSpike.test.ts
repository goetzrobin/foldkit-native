import { describe, expect, it } from 'vitest'
import { createLegendDriver } from '../src/legend/driver.js'
import { peek$ } from '../src/legend/vendor/state/state.js'

describe('spike', () => {
  it('computes a range', async () => {
    const data = Array.from({ length: 1000 }, (_u, id) => ({ id }))
    const scrolls: unknown[] = []
    const driver = createLegendDriver<{ id: number }>(
      { scrollTo: o => scrolls.push(o), measureContainer: () => {}, measureScroller: () => {} },
      { data, keyExtractor: item => `k${item.id}`, renderItem: ({ item }) => `row ${item.id}`, estimatedItemSize: 50, recycleItems: true },
    )
    driver.afterCommit()
    driver.onLayout({ x: 0, y: 0, width: 320, height: 600 })
    const { ctx } = driver
    const n = peek$(ctx, 'numContainers')
    const rows = []
    for (let i = 0; i < n; i++) rows.push([peek$(ctx, `containerItemKey${i}`), peek$(ctx, `containerPosition${i}`)])
    process.stderr.write(JSON.stringify([n, peek$(ctx, 'numContainersPooled'), peek$(ctx, 'totalSize'), JSON.stringify(rows), ctx.state.startBuffered, ctx.state.endBuffered, scrolls]) + "\n")
    expect(n).toBeGreaterThan(0)
  })
})
