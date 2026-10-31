import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../../testing/sampleTown'
import { getBenchPose, getBenchSeats, getBenchLayout } from './characterPose'

describe('bench and character pose regressions', () => {
  it('faces the way the bench faces and exits in front of every bench', () => {
    getBenchSeats(SAMPLE_TOWN.objects).forEach((seat) => {
      const sitting = getBenchPose(seat, true)
      const standing = getBenchPose(seat, false)
      expect(sitting.rotation).toBe(seat.rotation)
      expect(
        (standing.x - seat.x) * Math.sin(seat.rotation) + (standing.z - seat.z) * Math.cos(seat.rotation),
      ).toBeCloseTo(1.35)
    })
  })

  it('offers one- and two-seat variants with separate anchors inside their visual/collider width', () => {
    const benches = SAMPLE_TOWN.objects.filter((object) => object.type === 'bench')
    const expectedSeatCount = benches.reduce((total, bench) => total + (bench.seats ?? 2), 0)
    expect(getBenchSeats(benches)).toHaveLength(expectedSeatCount)
    expect(new Set(getBenchSeats(benches).map((seat) => seat.id)).size).toBe(expectedSeatCount)
    benches.forEach((bench) => {
      const layout = getBenchLayout(bench)
      const seats = getBenchSeats([bench])
      expect(seats).toHaveLength(bench.seats ?? 2)
      seats.forEach((seat) => {
        expect(Math.abs(seat.x - bench.position.x) + 0.45).toBeLessThan(layout.width / 2)
        expect(seat.z).toBe(bench.position.z)
        expect(seat.rotation).toBe(layout.rotation)
      })
    })
  })
})
