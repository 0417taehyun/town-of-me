import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DERBY_PHASE_MS, RESULT_HOLD_MS } from '../../game/derby'
import { RELEASE_POINT } from '../../game/pitch'
import { createPitcher, type Pitcher, posePitcher } from './pitcher'

const release = new Vector3(RELEASE_POINT.x, RELEASE_POINT.y, RELEASE_POINT.z)

function handAndBall(pitcher: Pitcher, seconds: number) {
  posePitcher(pitcher, seconds)
  pitcher.rig.root.updateMatrixWorld(true)
  return { hand: pitcher.hand.getWorldPosition(new Vector3()), ball: pitcher.ballPoint.clone() }
}

describe('pitcher', () => {
  it('hands the ball off at the game core’s release point as the windup ends', () => {
    const pitcher = createPitcher()
    const { hand, ball } = handAndBall(pitcher, 0)
    expect(ball.distanceTo(release)).toBeLessThan(0.005)
    expect(hand.distanceTo(release)).toBeLessThan(0.1)
    expect(handAndBall(pitcher, -0.3).ball.distanceTo(release)).toBeGreaterThan(0.5)
  })

  it('lets go with his hand still driving toward home', () => {
    const pitcher = createPitcher()
    const towardHome = (seconds: number) =>
      (handAndBall(pitcher, seconds + 0.005).ball.z - handAndBall(pitcher, seconds - 0.005).ball.z) / 0.01
    const throwing = Array.from({ length: 31 }, (_, step) => towardHome(-0.3 + step * 0.01))
    expect(towardHome(0)).toBeGreaterThan(0.4 * Math.max(...throwing))
  })

  it('is back in his set, the ball in his glove, before the next windup can begin', () => {
    const pitcher = createPitcher()
    const set = handAndBall(pitcher, -DERBY_PHASE_MS.windup / 1000)
    const feet = pitcher.rig.feet.map((foot) => foot.getWorldPosition(new Vector3()))
    const soonestNextWindup = (Math.min(...Object.values(RESULT_HOLD_MS)) + DERBY_PHASE_MS.ready) / 1000
    const next = handAndBall(pitcher, soonestNextWindup)
    expect(next.ball.distanceTo(set.ball)).toBeLessThan(0.001)
    pitcher.rig.feet.forEach((foot, index) =>
      expect(foot.getWorldPosition(new Vector3()).distanceTo(feet[index])).toBeLessThan(0.001),
    )
  })
})
