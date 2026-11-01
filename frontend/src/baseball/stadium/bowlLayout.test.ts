import { describe, expect, it } from 'vitest'
import { fenceDistance } from '../game/field'
import { FENCE_RULES, LONGEST_CARRY, SPRAY_RULES } from '../game/landing'
import { wideShot } from '../stage/cameraShots'
import { gardenTrees, outerHedgeDistance, sprayOf } from './bowlLayout'
import { landmarkFootprints } from './landmarkLayout'

/** Every home run the judge can give, on a grid of sprays and carries. */
function homeRunLandings() {
  return Array.from({ length: 25 }, (_, step) => -SPRAY_RULES.fairEdge + (step / 12) * SPRAY_RULES.fairEdge).flatMap(
    (spray) =>
      Array.from({ length: 12 }, (_, step) => {
        const shortest = fenceDistance(spray) + FENCE_RULES.clearance
        return { spray, distance: shortest + (step / 11) * (LONGEST_CARRY - shortest) }
      }),
  )
}

describe('the garden beyond the outfield', () => {
  it('keeps every home run and its landing camera clear of the trees and landmarks, inside the outer hedge', () => {
    const landmarks = landmarkFootprints()
    const trees = gardenTrees(landmarks)
    homeRunLandings().forEach(({ spray, distance }) => {
      const { position } = wideShot(spray, distance)
      const landing = { x: Math.sin(spray) * distance, z: -Math.cos(spray) * distance }
      ;[position, landing].forEach((spot) => {
        const nearestTree = Math.min(
          ...trees.map((tree) => Math.hypot(tree.position.x - spot.x, tree.position.z - spot.z)),
        )
        expect(nearestTree).toBeGreaterThan(9)
        landmarks.forEach((landmark) =>
          expect(Math.hypot(landmark.x - spot.x, landmark.z - spot.z)).toBeGreaterThan(landmark.radius),
        )
        expect(Math.hypot(spot.x, spot.z)).toBeLessThan(outerHedgeDistance(sprayOf(spot.x, spot.z)) - 5)
      })
    })
  })
})
