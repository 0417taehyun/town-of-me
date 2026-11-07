import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../../../testing/sampleTown'
import { getCrownSway, getLeafDropSources, getSeasonalTreeSources, getTreeColliders } from './treeLayout'

describe('instanced tree trunk collisions', () => {
  it('covers every playable tree exactly once, never its broad canopy or other props', () => {
    const trees = SAMPLE_TOWN.objects.filter((object) => object.type === 'tree')
    const colliders = getTreeColliders(SAMPLE_TOWN.objects)
    expect(colliders).toHaveLength(trees.length)
    expect(colliders.length).toBeGreaterThan(50)
    expect(new Set(colliders.map((trunk) => trunk.id)).size).toBe(trees.length)
    colliders.forEach((trunk, index) => {
      expect(trunk.position[0]).toBe(trees[index].position.x)
      expect(trunk.position[2]).toBe(trees[index].position.z)
      expect(trunk.position[1] - trunk.halfHeight).toBeCloseTo(trees[index].position.y)
      expect(trunk.radius).toBeLessThan(0.65)
      expect(trunk.halfHeight * 2).toBeGreaterThan(2)
    })
  })

  it('chooses falling-petal and leaf trees by id, so removing one tree never changes the others', () => {
    const trees = SAMPLE_TOWN.objects.filter((object) => object.type === 'tree')
    const spring = getSeasonalTreeSources(trees, 'spring')
    const autumn = getSeasonalTreeSources(trees, 'autumn')
    expect(spring.length / trees.length).toBeGreaterThan(0.2)
    expect(spring.length / trees.length).toBeLessThan(0.6)
    expect(autumn.length / trees.length).toBeGreaterThan(0.2)
    expect(autumn.length / trees.length).toBeLessThan(0.6)
    const winter = getSeasonalTreeSources(trees, 'winter')
    expect(winter.length / trees.length).toBeGreaterThan(0.2)
    expect(winter.length / trees.length).toBeLessThan(0.6)
    const remaining = trees.slice(1)
    const springIds = (sources: typeof spring, list: typeof trees) => sources.map(({ treeIndex }) => list[treeIndex].id)
    expect(springIds(getSeasonalTreeSources(remaining, 'spring'), remaining)).toEqual(
      springIds(spring, trees).filter((id) => id !== trees[0].id),
    )
  })

  it('sheds every crown before winter, only the blossoms after spring, and nothing out of winter', () => {
    const trees = SAMPLE_TOWN.objects.filter((object) => object.type === 'tree')
    const autumn = getLeafDropSources(trees, 'autumn', 'winter')
    expect(autumn).toHaveLength(trees.length)
    expect(new Set(autumn.flatMap(({ colors }) => colors)).size).toBeGreaterThan(4)
    expect(getLeafDropSources(trees, 'spring', 'summer').map(({ treeIndex }) => treeIndex)).toEqual(
      getSeasonalTreeSources(trees, 'spring').map(({ treeIndex }) => treeIndex),
    )
    expect(getLeafDropSources(trees, 'spring', 'winter')).toHaveLength(trees.length)
    expect(getLeafDropSources(trees, 'winter', 'spring')).toEqual([])
    const tinted = getLeafDropSources([{ ...trees[0], color: '#123456' }], 'autumn', 'winter')
    expect(tinted[0].colors).toEqual(['#123456', '#123456'])
  })

  it('keeps still crowns in place even in the opening season, whose change began at minus infinity', () => {
    expect(getCrownSway(0, Infinity, 3, 1)).toEqual({ x: 0, z: 0 })
    expect(Math.hypot(getCrownSway(1, 0.3, 3, 1).x, getCrownSway(1, 0.3, 3, 1).z)).toBeGreaterThan(0.01)
  })
})
