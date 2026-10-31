import type { Group } from 'three'
import { TOWN_GROUND_LIMIT, type TownPet, type TownPoint, type Vec3 } from '../../data/models'
import { clamp, clamp01, damp, dampAngle } from '../../motionMath'
import { nextRouteIndex } from '../motion/npcMotion'

/** The default walk, as offsets from the fountain's center. */
const loopAroundFountain = [
  [-4, 0],
  [-18, 0],
  [-25, -10],
  [-12, -19],
  [0, -19],
  [18, -19],
  [25, -8],
  [25, 0],
  [8, 0],
  [0, 8],
] as const

/** The default loop around wherever the fountain stands, kept on the town's ground. */
export function getDefaultPetRoute(fountain: Vec3 = { x: 0, y: 0, z: 0 }): TownPoint[] {
  const onGround = (value: number) => clamp(value, -TOWN_GROUND_LIMIT, TOWN_GROUND_LIMIT)
  return loopAroundFountain.map(([x, z]) => [onGround(fountain.x + x), onGround(fountain.z + z)] as const)
}

export function getPetRoute(pet: TownPet, fountain: Vec3 | undefined) {
  return pet.route ?? getDefaultPetRoute(fountain)
}

export type CorgiWalk = { routeIndex: number; waitUntil: number; speed: number }

/** Trots the corgi toward the next point of its loop, pausing a moment at each; returns whether it moved this frame. */
export function walkCorgiRoute(
  node: Group,
  state: CorgiWalk,
  route: readonly TownPoint[],
  elapsed: number,
  delta: number,
) {
  if (state.waitUntil > elapsed) return false
  // The route can shrink while the editor changes it, so the index wraps onto the current loop.
  const [targetX, targetZ] = route[state.routeIndex % route.length]
  const differenceX = targetX - node.position.x
  const differenceZ = targetZ - node.position.z
  const distance = Math.hypot(differenceX, differenceZ)
  if (distance < 0.08) {
    state.routeIndex = nextRouteIndex(state.routeIndex % route.length, route.length)
    state.waitUntil = elapsed + 0.5 + Math.random() * 1.8
    state.speed = 0
    return false
  }
  state.speed = damp(state.speed, clamp(distance * 2.2, 0.25, 3.1), 7, delta)
  const step = Math.min(distance, state.speed * delta)
  node.position.x += (differenceX / distance) * step
  node.position.z += (differenceZ / distance) * step
  node.rotation.y = dampAngle(node.rotation.y, Math.atan2(differenceX, differenceZ), 10, delta)
  return true
}

/** Swings one leg from the hip and keeps its paw level, raising the hip so the paw stays on the ground. */
export function poseCorgiLeg(leg: Group | null, paw: Group | null, swing: number, lift: number) {
  if (!leg || !paw) return
  leg.rotation.x = swing
  leg.position.y = Math.cos(swing) * 0.36 + 0.08 + lift
  paw.rotation.x = -swing
}

export function getCorgiGait(
  elapsed: number,
  walkStrength: number,
  happy: boolean,
  reducedMotion: boolean,
  result = { angles: [0, 0, 0, 0], lifts: [0, 0, 0, 0], bodyY: 0, bodyTilt: 0, headTilt: 0, tailWag: 0 },
) {
  const softness = reducedMotion ? 0.3 : 1
  const walking = clamp01(walkStrength)
  for (let index = 0; index < 4; index += 1) {
    const phase = elapsed * 18 + (index === 1 || index === 2 ? Math.PI : 0)
    result.angles[index] = walking === 0 ? 0 : Math.cos(phase) * 0.78 * walking
    result.lifts[index] = Math.max(0, Math.sin(phase)) * 0.095 * walking
  }
  result.bodyY = (1 - Math.cos(elapsed * 36)) * 0.012 * softness * walking
  result.bodyTilt = Math.sin(elapsed * 18) * 0.025 * softness * walking
  result.headTilt = happy ? -0.12 : Math.sin(elapsed * 18) * 0.025 * softness * walking
  result.tailWag = Math.sin(elapsed * (happy ? 12 : 5)) * (happy ? 0.45 : 0.16) * softness
  return result
}
