import { describe, expect, it } from 'vitest'
import { applyVenuePalette, createVenueMaterials } from './venueMaterials'

describe('venue materials', () => {
  it('recolors the same material instances, each role on its own', () => {
    const materials = createVenueMaterials({ walls: '#ece3cc', roof: '#ca7765' })
    const walls = materials.walls
    applyVenuePalette(materials, { walls: '#335577', roof: '#ca7765' })
    expect(materials.walls).toBe(walls)
    expect(walls.color.getHexString()).toBe('335577')
    expect(materials.roof.color.getHexString()).toBe('ca7765')
  })
})
