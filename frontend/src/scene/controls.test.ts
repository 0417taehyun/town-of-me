import { expect, it } from 'vitest'
import {
  AUTO_SPRINT_SECONDS,
  claimControlPointer,
  movementHoldDuration,
  releaseControlPointer,
  shouldSprint,
} from './controls'

it('auto-sprints for sustained keyboard or touch movement, then resets on release or opposing keys', () => {
  const keyboard = movementHoldDuration(0.5, 1, 0, 0.15)
  const touch = movementHoldDuration(0.5, 0.4, 0.7, 0.15)
  expect(shouldSprint(keyboard, false)).toBe(true)
  expect(shouldSprint(touch, false)).toBe(true)
  expect(shouldSprint(AUTO_SPRINT_SECONDS - 0.01, false)).toBe(false)
  expect(shouldSprint(0, true)).toBe(true)
  expect(movementHoldDuration(1, 0, 0, 0.02)).toBe(0)
  expect(movementHoldDuration(1, 0.05, 0.05, 0.02)).toBe(0)
})

it('keeps joystick and RUN pointer ownership independent through multi-touch releases', () => {
  const joystickPointer = claimControlPointer(null, 1)
  const sprintPointer = claimControlPointer(null, 2)
  expect(claimControlPointer(joystickPointer, 3)).toBe(1)
  expect(releaseControlPointer(joystickPointer, sprintPointer)).toBe(1)
  expect(releaseControlPointer(sprintPointer, joystickPointer)).toBe(2)
  expect(releaseControlPointer(sprintPointer, 2)).toBeNull()
  expect(releaseControlPointer(joystickPointer, 1)).toBeNull()
})
