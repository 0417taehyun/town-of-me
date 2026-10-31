import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import {
  duplicateObjects,
  getObjectOrigins,
  getRemovalBlocks,
  moveObjects,
  randomizeRotations,
  randomizeSizes,
  removeObjects,
  setObjectsVariant,
} from './bulkEditing'
import { changeObjects } from './townEditing'

const sequence = (...values: number[]) => {
  let index = 0
  return () => values[index++ % values.length]
}
const find = (id: string, town = SAMPLE_TOWN) => town.objects.find((object) => object.id === id)!

describe('bulk editing', () => {
  it('changes exactly the listed objects and leaves every other object identical', () => {
    const colored = changeObjects(['flower-0', 'flower-1'], { color: '#123456' })(SAMPLE_TOWN)
    expect([find('flower-0', colored).color, find('flower-1', colored).color]).toEqual(['#123456', '#123456'])
    expect(colored.objects.filter((object, index) => object !== SAMPLE_TOWN.objects[index])).toHaveLength(2)
  })

  it('saves a variant only on kinds that offer it, and Automatic clears it again', () => {
    const roses = setObjectsVariant(SAMPLE_TOWN, ['flower-0', 'tree-0', 'lamp-1'], 'rose')
    expect(find('flower-0', roses).variant).toBe('rose')
    expect(find('tree-0', roses)).toBe(find('tree-0'))
    expect(find('lamp-1', roses)).toBe(find('lamp-1'))
    expect(find('flower-0', setObjectsVariant(roses, ['flower-0'], undefined)).variant).toBeUndefined()
  })

  it('gives each object its own size and rotation within the range, either way round and inside the limits', () => {
    const sized = randomizeSizes(
      SAMPLE_TOWN,
      ['tree-0', 'tree-1', 'tree-2'],
      { minimum: 0.5, maximum: 1.5 },
      sequence(0, 1, 0.333),
    )
    expect(['tree-0', 'tree-1', 'tree-2'].map((id) => find(id, sized).scale)).toEqual([0.5, 1.5, 0.83])
    const reversed = randomizeSizes(SAMPLE_TOWN, ['tree-0'], { minimum: 2, maximum: 1 }, sequence(0.25))
    expect(find('tree-0', reversed).scale).toBe(1.75)
    const limited = randomizeSizes(SAMPLE_TOWN, ['tree-0', 'tree-1'], { minimum: 0, maximum: 9 }, sequence(0, 1))
    expect([find('tree-0', limited).scale, find('tree-1', limited).scale]).toEqual([0.3, 3])
    const turned = randomizeRotations(SAMPLE_TOWN, ['bird-0', 'bird-1'], { minimum: -90, maximum: 400 }, sequence(0, 1))
    expect(find('bird-0', turned).rotation).toBeCloseTo(-Math.PI / 2)
    expect(find('bird-1', turned).rotation).toBeCloseTo(Math.PI)
  })

  it('moves a group by one offset from where the drag started, clamping each object and keeping sky heights', () => {
    const origins = getObjectOrigins(SAMPLE_TOWN, ['lamp-1', 'lamp-2', 'bird-0'])
    const moved = moveObjects(SAMPLE_TOWN, origins, { x: 50, z: 1 })
    expect(find('lamp-1', moved).position).toEqual({ x: 43, y: 0, z: -6 })
    expect(find('lamp-2', moved).position).toEqual({ x: 52, y: 0, z: -6 })
    expect(find('bird-0', moved).position).toMatchObject({ x: 34.5, y: 5.2, z: 33 })
    const back = moveObjects(moved, origins, { x: 0, z: 0 })
    expect(find('lamp-2', back).position).toEqual(find('lamp-2').position)
  })

  it('copies a group beside itself with fresh unique ids, skipping the landmarks', () => {
    const copied = duplicateObjects(SAMPLE_TOWN, ['lamp-1', 'fountain', 'lamp-2'], sequence(0.1, 0.1, 0.9))
    expect(copied.ids).toHaveLength(2)
    expect(new Set([...copied.ids, ...SAMPLE_TOWN.objects.map(({ id }) => id)]).size).toBe(
      SAMPLE_TOWN.objects.length + 2,
    )
    expect(copied.ids.map((id) => find(id, copied.town).position.x)).toEqual([
      find('lamp-1').position.x + 3,
      find('lamp-2').position.x + 3,
    ])
    expect(duplicateObjects(SAMPLE_TOWN, ['fountain', 'guestbook']).town).toBe(SAMPLE_TOWN)
  })

  it('deletes what the town can do without and keeps landmarks and benches residents rest on', () => {
    const ids = ['lamp-1', 'fountain', 'bench-north', 'tree-3']
    const removed = removeObjects(SAMPLE_TOWN, ids)
    const remaining = removed.objects.map(({ id }) => id).filter((id) => ids.includes(id))
    expect(new Set(remaining)).toEqual(new Set(['fountain', 'bench-north']))
    expect(getRemovalBlocks(SAMPLE_TOWN, ids)).toEqual({ singleton: ['fountain'], 'bench-in-use': ['bench-north'] })
    expect(removeObjects(SAMPLE_TOWN, ['fountain'])).toBe(SAMPLE_TOWN)
  })
})
