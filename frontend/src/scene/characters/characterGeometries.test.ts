import { describe, expect, it } from 'vitest'
import { Color } from 'three'
import { avatarPart } from './avatarAppearance'
import { characterGeometries, mergeAvatarParts } from './characterGeometries'

describe('merged character heads', () => {
  // The rounded box has no index while the other shapes do, so this also covers merging both kinds.
  it('keeps every part where its mesh drew it, in its own color', () => {
    const hat = avatarPart('hat', 'box', [0, 0.6, 0], [0.4, 0.3, 0.4], '#ff0000')
    const ear = avatarPart('ear', 'sphere', [0.4, 0, 0], [0.1, 0.1, 0.1], '#0000ff')
    const merged = mergeAvatarParts([hat, ear])
    const boxVertices = characterGeometries.box.attributes.position.count
    const positions = merged.attributes.position
    expect(positions.count).toBe(boxVertices + characterGeometries.sphere.attributes.position.count)
    const hatTop = Math.max(...Array.from({ length: boxVertices }, (_, index) => positions.getY(index)))
    expect(hatTop).toBeCloseTo(0.6 + 0.15)
    const earColor = new Color('#0000ff')
    expect(merged.attributes.color.getZ(boxVertices)).toBeCloseTo(earColor.b)
    expect(merged.attributes.color.getX(boxVertices)).toBeCloseTo(earColor.r)
  })
})
