import type { Box3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../data/models'
import { DIFFICULTY_RULES, PRACTICE_PITCH_FLIGHT_SECONDS } from '../game/difficulty'
import { BATTER_REACH, STRIKE_ZONE } from '../game/field'
import { contactSeconds, PITCH_TYPE_IDS, pitchPosition, planPitch, secondsAtDepth } from '../game/pitch'
import { PITCH_TARGET_BAND, PRACTICE_SCHEDULE } from '../game/pitchSchedule'
import { DRAWN_RIM_RADIUS } from './ballMeshes'
import { drawnPitchSeconds } from './stageRun'
import { createStrikeZoneOutline, drawStrikeZoneOutline, STRIKE_ZONE_OUTLINE } from './strikeZoneOutline'

/**
 * Whether the drawn ball at `ball`, rim and all, is between the faces of the box `bounds` holds and in its opening. The
 * geometry keeps 32-bit floats, so a ball in a face's plane may lie a micrometre past it.
 */
function inBox(bounds: Box3, { x, y, z }: Vec3) {
  const { barWidth } = STRIKE_ZONE_OUTLINE
  const betweenFaces = z > bounds.min.z - 1e-6 && z < bounds.max.z + 1e-6
  const room = Math.min(
    x - bounds.min.x - barWidth,
    bounds.max.x - barWidth - x,
    y - bounds.min.y - barWidth,
    bounds.max.y - barWidth - y,
  )
  return betweenFaces && room > DRAWN_RIM_RADIUS
}

describe('strike zone outline', () => {
  // Inside the box on the field is inside it on screen from any camera, the batting shot's included, and at the front
  // and back faces the ball is in the face's own plane.
  it('draws every pitch inside the box, rim and all, from the swing over the plate until it waits for a late swing', () => {
    const outline = createStrikeZoneOutline()
    outline.geometry.computeBoundingBox()
    const bounds = outline.geometry.boundingBox
    const targets = [PITCH_TARGET_BAND.low, STRIKE_ZONE.center, PITCH_TARGET_BAND.high].flatMap((y) =>
      [-PITCH_TARGET_BAND.side, 0, PITCH_TARGET_BAND.side].map((x) => ({ x, y })),
    )
    const pitches = [
      ...PRACTICE_SCHEDULE.map(({ type, target }) => ({ type, target, pace: PRACTICE_PITCH_FLIGHT_SECONDS })),
      ...Object.values(DIFFICULTY_RULES).flatMap(({ pitchFlightSeconds: pace }) =>
        PITCH_TYPE_IDS.flatMap((type) => targets.map((target) => ({ type, target, pace }))),
      ),
    ]
    const moments = pitches.flatMap(({ type, target, pace }) => {
      const plan = planPitch(type, pace, target)
      const swing = contactSeconds(plan)
      const reachBack = secondsAtDepth(plan, BATTER_REACH.back)
      const held = { index: 0, plan, releasedMs: 0, holdSeconds: reachBack + 1, caught: false }
      const seconds = [
        ...Array.from({ length: 21 }, (_, step) => swing + ((reachBack - swing) * step) / 20),
        secondsAtDepth(plan, STRIKE_ZONE.halfWidth),
        drawnPitchSeconds(held, reachBack + 0.5),
      ]
      return seconds.map((at) => ({ label: `${type} at (${target.x}, ${target.y}) over ${pace} s`, at, plan }))
    })
    const outside = moments
      .filter(({ plan, at }) => !bounds || !inBox(bounds, pitchPosition(plan, at)))
      .map(({ label, at }) => `${label}, ${at.toFixed(3)} s after release`)
    expect(outside).toEqual([])
  })

  it('fades in through the windup and is gone the moment the pitch is judged', () => {
    const outline = createStrikeZoneOutline()
    drawStrikeZoneOutline(outline, 'windup', 0.05, false)
    expect(outline.visible).toBe(true)
    expect(outline.material.opacity).toBeLessThan(STRIKE_ZONE_OUTLINE.opacity)
    drawStrikeZoneOutline(outline, 'pitch', 2, false)
    expect(outline.material.opacity).toBeCloseTo(STRIKE_ZONE_OUTLINE.opacity, 2)
    drawStrikeZoneOutline(outline, 'result', 0.016, false)
    expect(outline.visible).toBe(false)
    expect(outline.material.opacity).toBe(0)
    drawStrikeZoneOutline(outline, 'windup', 0.016, true)
    expect(outline.material.opacity).toBe(STRIKE_ZONE_OUTLINE.opacity)
  })
})
