import { describe, expect, it } from 'vitest'
import { createPlayerMovement, type SkidStyle } from '../scene/motion/skidTurn'
import { MOVEMENT_DEMO_STEPS, stepMovementDemo } from './movementDemo'

const loopSeconds = MOVEMENT_DEMO_STEPS.reduce((total, step) => total + step.seconds, 0)

function playOneLoop(style: SkidStyle) {
  const demo = { x: 0, elapsed: 0 }
  const movement = createPlayerMovement(Math.PI / 2)
  const slides = new Set<string>()
  Array.from({ length: Math.round(loopSeconds * 60) - 1 }, () => {
    stepMovementDemo(demo, movement, 1 / 60, style)
    movement.events.forEach(({ type }) => slides.add(type))
    movement.events.length = 0
  })
  return { slides, movement }
}

describe('editor movement preview', () => {
  it('shows the chosen skid when turning back at a run and stands still again before it loops', () => {
    const long = playOneLoop('long')
    expect(long.slides).toContain('skid')
    expect(Math.hypot(long.movement.velocity.x, long.movement.velocity.z)).toBeLessThan(0.05)
    expect(playOneLoop('off').slides.has('skid')).toBe(false)
  })
})
