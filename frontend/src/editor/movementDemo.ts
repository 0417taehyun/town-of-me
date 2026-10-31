import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from '../scene/motion/playerMotion'
import { stepPlayerMovement, type PlayerMovement, type SkidStyle } from '../scene/motion/skidTurn'

/** One beat of the editor's movement preview; `direction` is along the preview's track (+1 right, -1 left). */
export type MovementDemoStep = {
  label: 'standing' | 'walking' | 'running' | 'turningBack' | 'stopping'
  seconds: number
  direction: -1 | 0 | 1
  sprint: boolean
}

/** Every move the admin's choices change: the walk, the run, turning back at a run, and letting go at a run. */
export const MOVEMENT_DEMO_STEPS: MovementDemoStep[] = [
  { label: 'standing', seconds: 1, direction: 0, sprint: false },
  { label: 'walking', seconds: 2.4, direction: 1, sprint: false },
  { label: 'running', seconds: 1.6, direction: 1, sprint: true },
  { label: 'turningBack', seconds: 2, direction: -1, sprint: true },
  { label: 'stopping', seconds: 1.8, direction: 0, sprint: false },
]

const stepEnds = MOVEMENT_DEMO_STEPS.map((_, index) =>
  MOVEMENT_DEMO_STEPS.slice(0, index + 1).reduce((total, step) => total + step.seconds, 0),
)
const loopSeconds = stepEnds[stepEnds.length - 1]

export type MovementDemo = { x: number; elapsed: number }

/** Meters of track drawn on each side of the start; one demo loop travels well inside it. */
export const TRACK_LENGTH = 60

export function getMovementDemoStep(elapsed: number) {
  return MOVEMENT_DEMO_STEPS[stepEnds.findIndex((end) => elapsed < end)] ?? MOVEMENT_DEMO_STEPS[0]
}

/**
 * Plays the demo forward with the real movement code. Each loop starts again at the track's middle while standing,
 * so the preview never wanders off.
 */
export function stepMovementDemo(demo: MovementDemo, movement: PlayerMovement, delta: number, style: SkidStyle) {
  const looped = demo.elapsed + delta >= loopSeconds
  demo.elapsed = (demo.elapsed + delta) % loopSeconds
  demo.x = looped ? 0 : demo.x
  const step = getMovementDemoStep(demo.elapsed)
  movement.style = style
  const targetSpeed = step.sprint ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED
  stepPlayerMovement(movement, { x: step.direction, z: 0 }, targetSpeed, delta, { ...movement.velocity })
  demo.x += movement.velocity.x * delta
  return step
}

/** A light track with a line every half meter, so planted feet read as still and sliding feet as sliding. */
export function createTrackTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.fillStyle = '#d6c69c'
  context.fillRect(0, 0, 64, 64)
  context.fillStyle = '#8f7b55'
  context.fillRect(0, 0, 6, 64)
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.repeat.set(TRACK_LENGTH * 4, 1)
  texture.colorSpace = SRGBColorSpace
  return texture
}
