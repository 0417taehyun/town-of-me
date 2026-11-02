import { describe, expect, it } from 'vitest'
import { DIFFICULTY_RULES, PRACTICE_PITCH_FLIGHT_SECONDS } from './difficulty'
import { BATTER_REACH, CONTACT_DEPTH } from './field'
import { timingErrorMs } from './judging'
import { contactSeconds, meetSeconds, PITCH_TYPE_IDS, pitchPosition, planPitch } from './pitch'
import { PITCH_TARGET_BAND } from './pitchSchedule'

const paces = [PRACTICE_PITCH_FLIGHT_SECONDS, ...Object.values(DIFFICULTY_RULES).map((rule) => rule.pitchFlightSeconds)]
const targets = [
  { x: -PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.low },
  { x: 0, y: 0.6 },
  { x: PITCH_TARGET_BAND.side, y: PITCH_TARGET_BAND.high },
]
const pitches = paces.flatMap((pace) =>
  PITCH_TYPE_IDS.flatMap((type) =>
    targets.map((target) => ({ type, pace, target, plan: planPitch(type, pace, target) })),
  ),
)

/** How far below the line it left the hand along the ball crosses the plate. */
function dropAtPlate(type: (typeof PITCH_TYPE_IDS)[number], pace: number) {
  const plan = planPitch(type, pace, targets[1])
  return plan.release.y + plan.velocity.y * plan.flightSeconds - pitchPosition(plan, plan.flightSeconds).y
}

describe('pitch flight', () => {
  it('crosses the plate at its target when its flight time is up', () => {
    pitches.forEach(({ plan, target }) => {
      const atPlate = pitchPosition(plan, plan.flightSeconds)
      expect(atPlate.x).toBeCloseTo(target.x, 9)
      expect(atPlate.y).toBeCloseTo(target.y, 9)
      expect(atPlate.z).toBeCloseTo(0, 9)
    })
  })

  it('keeps its shape at every pace', () => {
    paces.forEach((pace) =>
      PITCH_TYPE_IDS.forEach((type) => expect(dropAtPlate(type, pace)).toBeCloseTo(dropAtPlate(type, paces[0]), 9)),
    )
  })

  it('reaches the contact point at the reference time, so a swing timed to the plate reads late', () => {
    pitches.forEach(({ plan }) => {
      expect(pitchPosition(plan, contactSeconds(plan)).z).toBeCloseTo(-CONTACT_DEPTH, 9)
      expect(timingErrorMs(plan, contactSeconds(plan) * 1000 + 70, 70)).toBeCloseTo(0, 9)
      expect(timingErrorMs(plan, plan.flightSeconds * 1000, 0)).toBeGreaterThan(0)
    })
  })

  it('meets an early or late swing where the ball comes within reach, and a later swing never earlier', () => {
    pitches.forEach(({ plan }) => {
      const reference = contactSeconds(plan)
      expect(meetSeconds(plan, reference)).toBeCloseTo(reference, 9)
      expect(-pitchPosition(plan, meetSeconds(plan, 0.1)).z).toBeCloseTo(BATTER_REACH.front, 9)
      expect(-pitchPosition(plan, meetSeconds(plan, plan.flightSeconds + 0.3)).z).toBeCloseTo(BATTER_REACH.back, 9)
      const swings = Array.from({ length: 60 }, (_, step) => (step / 40) * plan.flightSeconds)
      const meetings = swings.map((swing) => meetSeconds(plan, swing))
      meetings.slice(1).forEach((meeting, step) => expect(meeting).toBeGreaterThanOrEqual(meetings[step]))
    })
  })
})
