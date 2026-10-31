import type { CharacterPose } from './walkCycle'

/** How characters walk, chosen per town by the admin. */
export const GAIT_STYLES = ['plantedFeet', 'keyPoses'] as const
export type GaitStyle = (typeof GAIT_STYLES)[number]

/** What a gait reads each frame. `x`/`z` is the point between the feet on the ground, in town meters. */
export type GaitInput = {
  speed: number
  delta: number
  walkSpeed: number
  /** False while a skid or brake poses the legs; the gait should hold its feet rather than step. */
  advancing: boolean
  x: number
  z: number
  /** Which way the character faces, as `rotation.y` (0 faces +z). */
  yaw: number
}

export type Gait = {
  /** Writes this frame's legs, arms, and body into `pose`; movement layers and grounding come after. */
  step: (input: GaitInput, pose: CharacterPose) => CharacterPose
  /** Grows by one each time a foot touches down, for footstep sounds. */
  footfalls: () => number
}
