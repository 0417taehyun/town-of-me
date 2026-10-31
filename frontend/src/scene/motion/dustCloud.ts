import { Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three'
import type { PlanarVector } from './skidTurn'

export const DUST_CAPACITY = 90
/** Scaled to nothing, for an instance slot with no puff in it. */
export const HIDDEN_PUFF = new Matrix4().makeScale(0, 0, 0)
/** How far each shoe lands to the side of the body's line of travel. */
const FOOT_SPACING = 0.17
const placement = new Matrix4()
const turn = new Quaternion()
const tumble = new Euler()
const scale = new Vector3()

type DustParticle = {
  age: number
  life: number
  size: number
  spin: number
  position: Vector3
  velocity: Vector3
}

export type DustCloud = { particles: Array<DustParticle | null>; next: number }

export function createDustCloud(): DustCloud {
  return { particles: Array.from({ length: DUST_CAPACITY }, () => null), next: 0 }
}

/** A puff kicked up by a sliding shoe: it bursts out along `direction`, rises a little, swells, and fades. */
export function puffDust(
  cloud: DustCloud,
  at: { x: number; y: number; z: number },
  direction: PlanarVector,
  speed: number,
  size: number,
) {
  const push = speed * (0.6 + Math.random() * 0.6)
  cloud.particles[cloud.next] = {
    age: 0,
    life: 0.45 + Math.random() * 0.3,
    size: size * (0.7 + Math.random() * 0.6),
    spin: Math.random() * Math.PI * 2,
    position: new Vector3(at.x, at.y + 0.06 + Math.random() * 0.05, at.z),
    velocity: new Vector3(
      direction.x * push + (Math.random() - 0.5) * 0.8,
      0.4 + Math.random() * 0.6,
      direction.z * push + (Math.random() - 0.5) * 0.8,
    ),
  }
  cloud.next = (cloud.next + 1) % DUST_CAPACITY
}

/** A little cluster of puffs kicked back from a running shoe as it lands; `side` (-1 or 1) says which foot. */
export function puffFootfallDust(
  cloud: DustCloud,
  feet: { x: number; y: number; z: number },
  velocity: PlanarVector,
  side: number,
) {
  const speed = Math.hypot(velocity.x, velocity.z)
  if (speed < 0.01) return
  const back = { x: -velocity.x / speed, z: -velocity.z / speed }
  const shoe = { x: feet.x + back.z * side * FOOT_SPACING, y: feet.y, z: feet.z - back.x * side * FOOT_SPACING }
  puffDust(cloud, shoe, back, 0.9, 0.075)
  puffDust(cloud, shoe, back, 0.6, 0.06)
  puffDust(cloud, shoe, back, 0.35, 0.05)
}

/** Moves a puff on, slowing it as the air takes it, and returns its size now: it swells quickly, then shrinks away. */
export function stepDustParticle(particle: DustParticle, delta: number) {
  particle.age += delta
  particle.position.addScaledVector(particle.velocity, delta)
  particle.velocity.multiplyScalar(Math.exp(-3.2 * delta))
  particle.velocity.y += 0.3 * delta
  const progress = particle.age / particle.life
  const grown = progress < 0.18 ? progress / 0.18 : 1 - (progress - 0.18) / 0.82
  return particle.size * Math.max(0, grown) ** 0.8
}

/** Moves the puff in `slot` on and writes it to its instance; a finished puff frees its slot and hides. */
export function drawDustPuff(mesh: InstancedMesh, cloud: DustCloud, slot: number, delta: number) {
  const particle = cloud.particles[slot]
  const size = particle ? stepDustParticle(particle, delta) : 0
  if (!particle || particle.age >= particle.life) {
    cloud.particles[slot] = null
    mesh.setMatrixAt(slot, HIDDEN_PUFF)
    return
  }
  turn.setFromEuler(tumble.set(particle.spin, particle.spin * 0.7 + particle.age, 0))
  mesh.setMatrixAt(slot, placement.compose(particle.position, turn, scale.set(size, size * 0.8, size)))
}
