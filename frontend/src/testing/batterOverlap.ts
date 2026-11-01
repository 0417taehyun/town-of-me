// For tests only: how deep the batter, as last posed, sinks into itself, pair by pair, measured on its surfaces: points
// every centimeter along each part and sixteen round it, each tested against the solids it could touch. A point inside
// a mitten is hidden by it (a forearm runs into its hand, the handle through the palm) and left out, except against
// that mitten's own forearm partner. Nothing in the app imports this, so it never reaches the production bundle.
import { Vector3 } from 'three'
import { ARM_BONES, ARM_RADII, FOREARM_RADIUS, shoulderPoint } from '../baseball/stage/actors/ballplayerRig'
import { BAT, batRadiusAt } from '../baseball/stage/actors/bat'
import type { Batter } from '../baseball/stage/actors/batter'
import { type BodyVolume, bodyVolumes, penetration } from '../baseball/stage/actors/bodyVolumes'
import { MITTEN } from '../baseball/stage/actors/mittenHands'
import { PLAYER_SCALE } from '../baseball/stage/stageLayout'

/** A solid: how deep (rig units, positive inside) a point sits in it, and a ball round it to skip what is far. */
export type Solid = { depth: (point: Vector3) => number; center: Vector3; reach: number }
/** A part's surface as points, and a ball round them. */
export type Surface = { points: Vector3[]; center: Vector3; reach: number }

/** The pairs checked, each the deepest any surface of the first sinks into a solid of the second (field m). */
export const OVERLAP_PAIRS = [
  'bat in the head',
  'bat in the body',
  'bat in an arm',
  'arm in the head',
  'arm in the body',
  'arm in the other arm',
] as const
export type OverlapPair = (typeof OVERLAP_PAIRS)[number]

const AROUND = 16
const STEP = 0.01 / PLAYER_SCALE

const ANGLES = Array.from({ length: AROUND }, (_, step) => (step / AROUND) * Math.PI * 2)
const COSINES = ANGLES.map(Math.cos)
const SINES = ANGLES.map(Math.sin)
const across = new Vector3()
const other = new Vector3()

/** Points on a circle of `radius` round `axis` (unit) at `center`. */
export function ring(center: Vector3, axis: Vector3, radius: number): Vector3[] {
  across.set(Math.abs(axis.x) > 0.9 ? 0 : 1, Math.abs(axis.x) > 0.9 ? 1 : 0, 0)
  across.addScaledVector(axis, -across.dot(axis)).normalize()
  other.crossVectors(axis, across)
  return COSINES.map(
    (cosine, step) =>
      new Vector3(
        center.x + radius * (across.x * cosine + other.x * SINES[step]),
        center.y + radius * (across.y * cosine + other.y * SINES[step]),
        center.z + radius * (across.z * cosine + other.z * SINES[step]),
      ),
  )
}

/** A cylinder's side from `from` to `to`, `radius` round, as rings a centimeter apart (with both ends). */
export function cylinderSurface(from: Vector3, to: Vector3, radius: number): Surface {
  const axis = to.clone().sub(from)
  const length = axis.length()
  axis.divideScalar(length)
  const count = Math.max(1, Math.ceil(length / STEP))
  const points = Array.from({ length: count + 1 }, (_, step) =>
    ring(from.clone().lerp(to, step / count), axis, radius),
  ).flat()
  return { points, center: from.clone().lerp(to, 0.5), reach: length / 2 + radius }
}

/** A ball's surface, `radius` round `center`. */
export function sphereSurface(center: Vector3, radius: number): Surface {
  const rows = [-0.75, -0.4, 0, 0.4, 0.75].map((height) =>
    ring(
      center.clone().addScaledVector(new Vector3(0, 1, 0), height * radius),
      new Vector3(0, 1, 0),
      radius * Math.sqrt(1 - height * height),
    ),
  )
  const poles = [-1, 1].map((end) => center.clone().add(new Vector3(0, end * radius, 0)))
  return { points: [...rows.flat(), ...poles], center: center.clone(), reach: radius }
}

/** The bat as last posed, its surface every centimeter from its knob to its tip. */
export function batSurface(batter: Batter): Surface {
  const { knob, axis } = batter
  const count = Math.ceil(BAT.length / STEP)
  const points = Array.from({ length: count + 1 }, (_, step) => {
    const height = (BAT.length * step) / count
    return ring(knob.clone().addScaledVector(axis, height), axis, batRadiusAt(height))
  }).flat()
  return { points, center: knob.clone().addScaledVector(axis, BAT.length / 2), reach: BAT.length / 2 + 0.04 }
}

const fromKnob = new Vector3()
const along = new Vector3()
const fromStart = new Vector3()
const closest = new Vector3()
const local = new Vector3()

/** The bat as last posed, as a solid. */
export function batSolid(batter: Batter): Solid {
  const knob = batter.knob.clone()
  const axis = batter.axis.clone()
  const depth = (point: Vector3) => {
    fromKnob.copy(point).sub(knob)
    const height = fromKnob.dot(axis)
    const radial = fromKnob.addScaledVector(axis, -height).length()
    const inside = height >= 0 && height <= BAT.length
    return inside ? Math.min(batRadiusAt(height) - radial, height, BAT.length - height) : -1
  }
  return { depth, center: knob.clone().addScaledVector(axis, BAT.length / 2), reach: BAT.length / 2 + 0.04 }
}

/** The distance from `point` to the segment from `from` to `to`. */
export function segmentGap(point: Vector3, from: Vector3, to: Vector3) {
  along.copy(to).sub(from)
  const share = Math.min(1, Math.max(0, fromStart.copy(point).sub(from).dot(along) / Math.max(along.lengthSq(), 1e-12)))
  return closest.copy(from).addScaledVector(along, share).distanceTo(point)
}

/** A capsule from `from` to `to`, `radius` round, as a solid. */
export function capsuleSolid(from: Vector3, to: Vector3, radius: number): Solid {
  const [start, end] = [from.clone(), to.clone()]
  const depth = (point: Vector3) => radius - segmentGap(point, start, end)
  return { depth, center: start.clone().lerp(end, 0.5), reach: start.distanceTo(end) / 2 + radius }
}

/** Mitten `index` as last posed: its turn and center, so a point can be brought into its own frame. */
export function mittenFrame(batter: Batter, index: number) {
  const mitten = batter.mittens[index]
  return { index, position: mitten.position.clone(), inverse: mitten.quaternion.clone().invert() }
}

/** How deep (rig units) `point` sits in the squashed capsule of the mitten posed by `frame`. */
export function mittenDepth(frame: ReturnType<typeof mittenFrame>, point: Vector3) {
  local.copy(point).sub(frame.position).applyQuaternion(frame.inverse)
  const squash = MITTEN.wide / MITTEN.thick
  const half = MITTEN.long - MITTEN.wide
  const lengthwise = local.z - MITTEN.center
  const offAxis = Math.hypot(local.x * squash, local.y, lengthwise - Math.max(-half, Math.min(half, lengthwise)))
  return (MITTEN.wide - offAxis) / squash
}

/** Mitten `index` as a solid. */
export function mittenSolid(batter: Batter, index: number): Solid {
  const frame = mittenFrame(batter, index)
  return { depth: (point) => mittenDepth(frame, point), center: frame.position, reach: MITTEN.long + 0.03 }
}

/** Mitten `index`'s surface: rings along its long axis and its rounded ends, squashed palm to back. */
export function mittenSurface(batter: Batter, index: number): Surface {
  const { position, inverse } = mittenFrame(batter, index)
  const turn = inverse.clone().invert()
  const squash = MITTEN.wide / MITTEN.thick
  const half = MITTEN.long - MITTEN.wide
  const local = (x: number, y: number, z: number) =>
    new Vector3(x / squash, y, z + MITTEN.center).applyQuaternion(turn).add(position)
  const rings = [-half, 0, half].flatMap((z) =>
    ring(new Vector3(0, 0, z), new Vector3(0, 0, 1), MITTEN.wide).map((point) => local(point.x, point.y, point.z)),
  )
  const caps = [-1, 1].flatMap((end) =>
    [30, 60].flatMap((polar) => {
      const radians = (polar * Math.PI) / 180
      const z = end * (half + MITTEN.wide * Math.sin(radians))
      return ring(new Vector3(0, 0, z), new Vector3(0, 0, 1), MITTEN.wide * Math.cos(radians)).map((point) =>
        local(point.x, point.y, point.z),
      )
    }),
  )
  const tips = [-1, 1].map((end) => local(0, 0, end * (half + MITTEN.wide)))
  return { points: [...rings, ...caps, ...tips], center: position.clone(), reach: MITTEN.long + 0.03 }
}

/** `volumes` as solids. */
export function volumeSolids(volumes: BodyVolume[]): Solid[] {
  return volumes.map((volume) => ({
    depth: (point: Vector3) => penetration(volume, point, 0),
    center: volume.center,
    reach: volume.radii.length(),
  }))
}

/** Whether `surface` comes anywhere near `solid`. */
export function near(surface: Surface, solid: Solid) {
  return surface.center.distanceTo(solid.center) < surface.reach + solid.reach
}

/** The deepest (rig units) any point of `surface` not hidden in one of `hiders` sinks into any of `solids`. */
export function deepest(surface: Surface, solids: Solid[], hiders: Solid[]) {
  const touching = solids.filter((solid) => near(surface, solid))
  const covering = hiders.filter((hider) => near(surface, hider))
  const center = touching
    .reduce((sum, solid) => sum.add(solid.center), new Vector3())
    .divideScalar(touching.length || 1)
  const reach = Math.max(0, ...touching.map((solid) => solid.center.distanceTo(center) + solid.reach))
  const close = surface.points.filter((point) => point.distanceTo(center) < reach)
  const inside = (point: Vector3) =>
    touching.reduce(
      (most, solid) => (point.distanceTo(solid.center) < solid.reach ? Math.max(most, solid.depth(point)) : most),
      0,
    )
  const sinking = close.map((point) => ({ point, depth: inside(point) })).filter(({ depth }) => depth > 0)
  const shown = sinking.filter(({ point }) => covering.every((hider) => hider.depth(point) <= 0))
  return shown.reduce((most, { depth }) => Math.max(most, depth), 0)
}

/** The parts of arm `index` as last posed: its shoulder, elbow, and wrist (rig frame). */
export function armJoints(batter: Batter, index: number) {
  const { rig } = batter
  return {
    shoulder: shoulderPoint(rig, index, new Vector3()),
    elbow: rig.elbows[index].clone(),
    wrist: rig.wrists[index].clone(),
  }
}

/** Arm `index`'s solids: its shoulder ball, upper arm, elbow ball, and forearm. */
export function armSolids(batter: Batter, index: number): Solid[] {
  const { shoulder, elbow, wrist } = armJoints(batter, index)
  return [
    capsuleSolid(shoulder, shoulder, ARM_RADII.shoulder),
    capsuleSolid(shoulder, elbow, ARM_RADII.upper),
    capsuleSolid(elbow, elbow, ARM_RADII.elbow),
    capsuleSolid(elbow, wrist, FOREARM_RADIUS),
  ]
}

/** Arm `index`'s surfaces: its shoulder ball, upper arm, elbow ball, and forearm, by name. */
export function armSurfaces(batter: Batter, index: number) {
  const { shoulder, elbow, wrist } = armJoints(batter, index)
  return {
    shoulder: sphereSurface(shoulder, ARM_RADII.shoulder),
    upper: cylinderSurface(shoulder, elbow, ARM_RADII.upper),
    elbow: sphereSurface(elbow, ARM_RADII.elbow),
    forearm: cylinderSurface(elbow, wrist, FOREARM_RADIUS),
  }
}

/**
 * How deep (field m) the batter as last posed sinks into itself, pair by pair: its bat into its head (with the hair
 * and hat), its body, and its arms; its arms (shoulders, upper arms, elbows, forearms, mittens) into its head; its
 * elbows, forearms, and mittens into its body, and its upper arms into its hips and legs (the front one crosses the
 * chest in the approved stance); and each arm into the other.
 */
export function batterOverlaps(batter: Batter): Record<OverlapPair, number> {
  const volumes = bodyVolumes(batter.rig)
  const head = volumeSolids(volumes.filter((volume) => volume.part === 'head'))
  const body = volumeSolids(volumes.filter((volume) => volume.part !== 'head'))
  const legs = volumeSolids(volumes.filter((volume) => volume.part === 'legs'))
  const mittens = [mittenSolid(batter, 0), mittenSolid(batter, 1)]
  const arms = [armSurfaces(batter, 0), armSurfaces(batter, 1)]
  const mittenSurfaces = [mittenSurface(batter, 0), mittenSurface(batter, 1)]
  const armSolidsOf = [armSolids(batter, 0), armSolids(batter, 1)]
  const bat = batSurface(batter)
  const batAsSolid = [batSolid(batter)]
  const armParts = (index: number) => Object.values(arms[index])
  const intoOther = [0, 1].map((index) => {
    const other = 1 - index
    const forearms = deepest(arms[index].forearm, [armSolidsOf[other][3]], mittens)
    const mittenIntoForearm = deepest(mittenSurfaces[index], [armSolidsOf[other][3]], [mittens[other]])
    const forearmIntoMitten = deepest(arms[other].forearm, [mittens[index]], [mittens[other]])
    const upperAndElbow = [arms[index].upper, arms[index].elbow].map((surface) =>
      deepest(surface, armSolidsOf[other], mittens),
    )
    const mittenIntoMitten = deepest(mittenSurfaces[index], [mittens[other]], [])
    return Math.max(forearms, mittenIntoForearm, forearmIntoMitten, mittenIntoMitten, ...upperAndElbow)
  })
  const depths: Record<OverlapPair, number> = {
    'bat in the head': deepest(bat, head, []),
    'bat in the body': deepest(bat, body, []),
    'bat in an arm': Math.max(
      deepest(bat, [...armSolidsOf[0], ...armSolidsOf[1]], mittens),
      ...[0, 1].map((index) => deepest(arms[index].forearm, batAsSolid, mittens)),
    ),
    'arm in the head': Math.max(
      ...[0, 1].flatMap((index) => armParts(index).map((surface) => deepest(surface, head, mittens))),
      ...mittenSurfaces.map((surface) => deepest(surface, head, [])),
    ),
    'arm in the body': Math.max(
      ...[0, 1].flatMap((index) =>
        [arms[index].elbow, arms[index].forearm].map((surface) => deepest(surface, body, mittens)),
      ),
      ...[0, 1].map((index) => deepest(arms[index].upper, legs, [])),
      ...mittenSurfaces.map((surface) => deepest(surface, body, [])),
    ),
    'arm in the other arm': Math.max(...intoOther),
  }
  return Object.fromEntries(OVERLAP_PAIRS.map((pair) => [pair, depths[pair] * PLAYER_SCALE])) as Record<
    OverlapPair,
    number
  >
}

/** How far (a share of its length) either upper arm of the batter as last posed is drawn longer than its bone. */
export function armStretch(batter: Batter) {
  return Math.max(
    ...[0, 1].map((index) => {
      const { shoulder, elbow } = armJoints(batter, index)
      return shoulder.distanceTo(elbow) / ARM_BONES.upper - 1
    }),
  )
}
