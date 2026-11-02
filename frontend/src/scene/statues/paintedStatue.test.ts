import { Mesh, Texture } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../data/playerProfile'
import { characterGeometries } from '../characters/characterGeometries'
import { CHARACTER_BODY } from '../characters/characterBody'
import { getRoundedBox } from '../roundedBox'
import { createPaintedStatue } from './paintedStatue'
import { STATUE_RANKS } from './statueFinishes'
import type { StatueTextures } from './statueTextures'

describe('painted statue', () => {
  it('frees what it made, but never the character geometry every town character shares, nor the canvas’s textures', () => {
    const textures: StatueTextures = {
      environment: new Texture(),
      sparkle: new Texture(),
      pool: new Texture(),
      frameMask: new Texture(),
      plaques: { 1: new Texture(), 2: new Texture(), 3: new Texture() },
    }
    const { torso } = CHARACTER_BODY
    const shared = [
      characterGeometries.hand,
      characterGeometries.sphere,
      getRoundedBox(torso.width, torso.height, torso.depth, torso.rounding),
    ]
    const sharedFreed = vi.fn()
    shared.forEach((geometry) => geometry.addEventListener('dispose', sharedFreed))
    const texturesFreed = vi.fn()
    Object.values({ ...textures, ...textures.plaques }).forEach((texture) =>
      (texture as Texture).addEventListener?.('dispose', texturesFreed),
    )
    const visitor = { ...DEFAULT_PLAYER_PROFILE, top: 'shirt' as const }
    const statues = [
      ...STATUE_RANKS.map((rank) => createPaintedStatue(visitor, rank, textures)),
      createPaintedStatue(null, 3, textures),
    ]
    const pedestalFreed = vi.fn()
    const [pedestalBody] = statues[0].group.children[0].children as Mesh[]
    pedestalBody.geometry.addEventListener('dispose', pedestalFreed)

    statues.forEach((statue) => statue.dispose())

    expect(pedestalFreed).toHaveBeenCalledOnce()
    expect(sharedFreed).not.toHaveBeenCalled()
    expect(texturesFreed).not.toHaveBeenCalled()
  })
})
