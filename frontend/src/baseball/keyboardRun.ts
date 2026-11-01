import type { RealTimeSwing } from './stage/stageRun'

// The keyboard's swings, until the camera-only change removes them: a run played with the keyboard (or the on-screen
// swing button) has no practice to calibrate from, and a key press is the moment the bat meets the ball. A camera run
// takes no key.

/** A key press or button press as a swing; `timeStamp` is the event's, on the performance.now() clock. */
export function keyboardSwing(timeStamp: number): RealTimeSwing {
  return { source: 'keyboard', contactAtRealMs: timeStamp, startedAtRealMs: timeStamp, speed: 0, batHeight: null }
}

/**
 * Space or Enter swings, held keys repeat nothing, and a key pressed on a focused control keeps its own meaning there:
 * Enter on the back link still leaves, and Space on a language button still switches. Only the swing button swings.
 */
export function isSwingKey(event: Pick<KeyboardEvent, 'key' | 'repeat' | 'target'>) {
  if (event.key !== ' ' && event.key !== 'Enter') return false
  const control = 'a, button:not(.derby-swing), input, select, textarea'
  const ownsKey = event.target instanceof Element && event.target.closest(control) !== null
  return !event.repeat && !ownsKey
}
