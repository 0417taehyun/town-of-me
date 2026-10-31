import { describe, expect, it } from 'vitest'
import { createDustCloud, puffDust, stepDustParticle } from './dustCloud'

describe('skid dust', () => {
  it('bursts along the slide, rises, swells quickly, and shrinks away', () => {
    const cloud = createDustCloud()
    puffDust(cloud, { x: 1, y: 0, z: 2 }, { x: 0, z: 1 }, 1.6, 0.13)
    const puff = cloud.particles[0]!
    expect(puff.position.y).toBeGreaterThan(0.05)
    const sizes = Array.from({ length: 40 }, () => stepDustParticle(puff, 1 / 60))
    const largest = sizes.indexOf(Math.max(...sizes))
    expect(largest).toBeGreaterThan(1)
    expect(largest).toBeLessThan(15)
    expect(sizes.at(-1)).toBeLessThan(sizes[largest])
    expect(puff.position.z).toBeGreaterThan(2.1)
    expect(puff.position.y).toBeGreaterThan(0.1)
  })
})
