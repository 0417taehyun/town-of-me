import { CapsuleGeometry, Group, MathUtils, Quaternion, SphereGeometry, Vector3 } from 'three'
import { clamp } from '../../../motionMath'
import {
  addPart,
  ARM_BONES,
  ARM_RADII,
  type BallplayerRig,
  basis,
  FOREARM_RADIUS,
  reachArm,
  shoulderPoint,
} from './ballplayerRig'
import { batPenetration } from './bat'
import { type BodyVolume, deepestPenetration, segmentDistance } from './bodyVolumes'
import { solveTwoBone } from './twoBoneIk'

// Animal Crossing mittens: the forearm runs, as thick as it is, into a soft round hand with the bat's handle through its
// palm (the visitor picked these over finger hands). Each mitten is a squashed capsule about 1.3 times the forearm's
// width; its long axis follows the forearm, tipped toward square-on to the bat as far as a wrist can bend, so the handle
// crosses it. The arm reaches for a wrist point buried in the mitten's back half, where it is already as thick as the
// forearm, so arm and hand read as one limb.
//
// A mitten's own frame: +y along the bat (toward the barrel), +z along the forearm toward the fingertips, +x from the
// back of the hand to the palm. Mitten 0 is the top hand (the back arm's), mitten 1 the bottom one, mirrored in x.

/**
 * Half-width across the bat, half-thickness palm to back, and half-length along the forearm; `center` shifts the
 * capsule toward the wrist so the handle runs through the palm; `wrist` buries the forearm's end behind the handle (and
 * sets the pitcher's and the catcher's bare mittens as far up their forearms, gloves.ts alignHand); `gap` spaces the
 * two mittens along the bat so they touch; `ulnar` and `radial` cap the tip toward square-on (degrees, inside the
 * wrist's 40° and 25°).
 */
export const MITTEN = {
  wide: 0.078,
  thick: 0.065,
  long: 0.095,
  center: -0.025,
  wrist: 0.07,
  gap: 0.16,
  ulnar: 38,
  radial: 23,
}
/**
 * How far an elbow may swivel off its keyed pole (degrees), how much leaving the pole costs, the search's steps, the
 * depth (rig units) a collision costs as much as straying `change` degrees from a neighbouring moment's swivel, and the
 * room (rig units) the search keeps round the arm, so it stays clear between the moments it is solved at.
 */
export const SWIVEL = { limit: 70, weight: 0.5, step: 5, steps: 6, depth: 0.008, change: 15, room: 0.005 }

/** A neighbouring moment's swivel (degrees) and how far from it (degrees) costs as much as a collision SWIVEL.depth. */
export type Neighbour = { swivel: number; change: number }

const { DEG2RAD } = MathUtils
const ACROSS = new Vector3(0, 1, 0)
const ALONG_FOREARM = new Vector3(0, 0, 1)
const PALM_SIDE = new Vector3(1, 0, 0)
const mittenGeometry = new CapsuleGeometry(MITTEN.wide, 2 * (MITTEN.long - MITTEN.wide), 8, 20)
const thumbGeometry = new SphereGeometry(1, 12, 8)

/** Mitten `index` in the batter's skin, added to the rig's root; only the top hand shows a small thumb bump. */
export function createMitten(rig: BallplayerRig, index: number) {
  const mitten = new Group()
  mitten.scale.x = index === 1 ? -1 : 1
  const hand = addPart(rig, mitten, mittenGeometry, rig.appearance.skin, 0.85)
  hand.rotation.x = Math.PI / 2
  hand.scale.x = MITTEN.thick / MITTEN.wide
  hand.position.z = MITTEN.center
  rig.root.add(mitten)
  if (index !== 0) return mitten
  const thumb = addPart(rig, mitten, thumbGeometry, rig.appearance.skin, 0.85)
  thumb.scale.set(0.022, 0.026, 0.032)
  thumb.position.set(MITTEN.thick * 0.72, MITTEN.wide * 0.6, 0.005)
  return mitten
}

const squareOn = new Vector3()
const tipAxis = new Vector3()

/**
 * The long axis of a mitten whose forearm points along unit `forearm`, holding a bat along unit `axis`: the forearm's
 * own direction tipped toward square-on to the bat, so the handle crosses the palm. Tipping away from the barrel bends
 * the wrist toward the little finger (ulnar), toward the barrel toward the thumb (radial); each stops at its cap.
 */
export function mittenAxis(out: Vector3, forearm: Vector3, axis: Vector3) {
  const along = forearm.dot(axis)
  squareOn.copy(forearm).addScaledVector(axis, -along)
  tipAxis.crossVectors(forearm, squareOn)
  if (squareOn.lengthSq() < 1e-8 || tipAxis.lengthSq() < 1e-10) return out.copy(forearm)
  const offSquare = Math.asin(Math.min(1, Math.abs(along)))
  const limit = (along > 0 ? MITTEN.ulnar : MITTEN.radial) * DEG2RAD
  return out.copy(forearm).applyAxisAngle(tipAxis.normalize(), Math.min(offSquare, limit))
}

/** Where a mitten settles for one elbow swivel: its forearm, long axis, wrist point, the arm's pole and IK elbow. */
export type SettledMitten = { forearm: Vector3; long: Vector3; wrist: Vector3; pole: Vector3; elbow: Vector3 }

export function createSettledMitten(): SettledMitten {
  return {
    forearm: new Vector3(),
    long: new Vector3(),
    wrist: new Vector3(),
    pole: new Vector3(),
    elbow: new Vector3(),
  }
}

const settled = createSettledMitten()
const swivelAxis = new Vector3()
const reachedWrist = new Vector3()

/** One fixed-point round of settleMitten: the forearm depends on where the wrist lands, and the wrist on the forearm. */
export function settleRound(
  out: SettledMitten,
  shoulder: Vector3,
  center: Vector3,
  axis: Vector3,
  pole: Vector3,
  swivel: number,
) {
  mittenAxis(out.long, out.forearm, axis)
  out.wrist.copy(center).addScaledVector(out.long, -MITTEN.wrist)
  swivelAxis.copy(out.wrist).sub(shoulder).normalize()
  out.pole.copy(pole).applyAxisAngle(swivelAxis, swivel * DEG2RAD)
  solveTwoBone(shoulder, out.wrist, ARM_BONES.upper, ARM_BONES.fore, out.pole, out.elbow, reachedWrist, true)
  out.forearm.copy(reachedWrist).sub(out.elbow).normalize()
}

/**
 * Settles a mitten on the handle at `center` for an arm from `shoulder` whose elbow swivels `swivel` degrees off
 * `pole` about the shoulder-to-wrist line, into `out`. It ends on the arm reaching its wrist point, so its elbow is the
 * one placeMitten poses and the elbow search clears the arm the batter shows.
 */
export function settleMitten(
  out: SettledMitten,
  shoulder: Vector3,
  center: Vector3,
  axis: Vector3,
  pole: Vector3,
  swivel: number,
) {
  out.forearm.copy(center).sub(shoulder).normalize()
  for (let round = 0; round < 4; round++) settleRound(out, shoulder, center, axis, pole, swivel)
  return out
}

const armPoint = new Vector3()

/**
 * Points along the forearm from the elbow (0) toward the wrist (1) that must stay off the bat; the rest runs into the
 * mitten round the handle, and stays off the bat beyond the stretch of the handle the mitten covers (FOREARM_END).
 */
export const FOREARM_FREE_SPAN = [0, 0.2, 0.4, 0.6]
/**
 * Points along the forearm's end, into its mitten, and how far (rig units) along the bat the mitten covers either way.
 */
export const FOREARM_END = { along: [0.65, 0.75, 0.85, 0.95], cover: 0.075 }

/** An arm's elbow and the wrist point it reaches for, and its mitten's center on the handle. */
export type ArmSegment = Pick<SettledMitten, 'elbow' | 'wrist'> & { center: Vector3 }

const fromKnob = new Vector3()

/** How far two forearms overlap, with room between them (rig units; 0 when clear). */
export function forearmOverlap(arm: ArmSegment, other: ArmSegment | null) {
  if (!other) return 0
  const room = 2 * (FOREARM_RADIUS + SWIVEL.room)
  return Math.max(0, room - segmentDistance(arm.elbow, arm.wrist, other.elbow, other.wrist))
}

/**
 * How far an arm from `shoulder` through `arm`'s elbow and wrist reaches into the bat (its forearm's end only beyond
 * the handle its mitten covers), the body, and the `other` arm's forearm (rig units), summed over points along its
 * forearm and upper arm. The upper arm counts against the head and the bat toward its elbow only: its shoulder end sits
 * in the torso, and the front one crosses the chest in the stance.
 */
export function armCollisionDepth(
  arm: ArmSegment,
  shoulder: Vector3,
  knob: Vector3,
  axis: Vector3,
  volumes: BodyVolume[],
  other: ArmSegment | null = null,
) {
  const head = volumes.filter((volume) => volume.part === 'head')
  const { elbow, wrist } = arm
  const { room } = SWIVEL
  const forearm = FOREARM_RADIUS + room
  const upperArm = ARM_RADII.upper + room
  const forearmInBat = FOREARM_FREE_SPAN.map((along) =>
    batPenetration(knob, axis, armPoint.copy(elbow).lerp(wrist, along), forearm),
  )
  const grip = fromKnob.copy(arm.center).sub(knob).dot(axis)
  const covered: [number, number] = [grip - FOREARM_END.cover, grip + FOREARM_END.cover]
  const forearmEndInBat = FOREARM_END.along.map((along) =>
    batPenetration(knob, axis, armPoint.copy(elbow).lerp(wrist, along), forearm, ...covered),
  )
  const forearmInBody = [0.3, 0.6, 0.85].map((along) =>
    deepestPenetration(volumes, armPoint.copy(elbow).lerp(wrist, along), forearm),
  )
  const upperArmInHead = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((along) =>
    deepestPenetration(head, armPoint.copy(shoulder).lerp(elbow, along), ARM_RADII.upper),
  )
  const upperArmInBat = [0.25, 0.5, 0.75, 1].map((along) =>
    batPenetration(knob, axis, armPoint.copy(shoulder).lerp(elbow, along), upperArm),
  )
  const parts = [
    ...forearmInBat,
    ...forearmEndInBat,
    deepestPenetration(volumes, elbow, ARM_RADII.elbow + room),
    ...forearmInBody,
    ...upperArmInHead,
    ...upperArmInBat,
    forearmOverlap(arm, other),
  ]
  return parts.reduce((sum, depth) => sum + depth, 0)
}

/** The step offset (-1..1) to the vertex of the parabola through three evenly spaced costs; 0 unless it is a minimum. */
export function parabolaOffset(before: number, at: number, after: number) {
  const curve = before - 2 * at + after
  return curve > 1e-9 ? clamp((0.5 * (before - after)) / curve, -1, 1) : 0
}

const searchShoulder = new Vector3()

/** The swivel between `neighbours`, each counting as much as its change lets it. */
export function betweenNeighbours(neighbours: Neighbour[]) {
  const weights = neighbours.map(({ change }) => 1 / (change * change))
  const total = weights.reduce((sum, value) => sum + value, 0)
  return neighbours.reduce((sum, { swivel }, index) => sum + swivel * weights[index], 0) / total
}

/** The lowest point of searchSwivel's cost with nothing hit: the swivel between `neighbours`, drawn toward the pole. */
export function smoothestSwivel(neighbours: Neighbour[], weight: number) {
  const pull = neighbours.reduce((sum, { swivel, change }) => sum + swivel / (change * change), 0)
  const stiffness = neighbours.reduce((sum, { change }) => sum + 1 / (change * change), weight / 45 ** 2)
  return pull / stiffness
}

/** The grid offsets either side of and at `lowest` among searchSwivel's `trials`, when all three are short of `limit`. */
export function aroundLowest(trials: number[], lowest: number, limit: number) {
  const inside = lowest > 0 && lowest < trials.length - 1
  const free = inside && Math.abs(trials[lowest - 1]) < limit && Math.abs(trials[lowest + 1]) < limit
  return free ? [lowest - 1, lowest, lowest + 1] : []
}

/**
 * Whether the middle of three neighbouring trials of searchSwivel's grid, the one nearest the lowest point of its cost
 * with nothing hit, hits nothing and costs least of the three, so the whole grid would pick it: with nothing hit the
 * cost is a parabola, and a hit only adds to it, so every trial further from that point costs more.
 */
export function bestOfGrid(trials: { cost: number; depth: number }[]) {
  if (trials.length !== 3 || trials[1].depth !== 0) return false
  return trials[1].cost < trials[0].cost && trials[1].cost <= trials[2].cost
}

/**
 * The elbow swivel for arm `index` holding the bat at `center` that keeps the arm off the bat, out of `volumes`, and
 * clear of the `other` arm's forearm, searched round its `neighbours` (the moments before and after) and paying for
 * every degree it strays from them and from the keyed pole, so a run of searches moves the elbow smoothly.
 */
export function searchSwivel(
  rig: BallplayerRig,
  index: number,
  center: Vector3,
  bat: { knob: Vector3; axis: Vector3 },
  pole: Vector3,
  neighbours: Neighbour[],
  volumes: BodyVolume[],
  other: ArmSegment | null = null,
) {
  const { limit, weight, step, steps: wide, depth: depthScale } = SWIVEL
  const near = betweenNeighbours(neighbours)
  const steps = neighbours.length > 1 ? Math.ceil(wide / 2) : wide
  const shoulder = shoulderPoint(rig, index, searchShoulder)
  const reach = ARM_BONES.upper + ARM_BONES.fore + 0.1
  const around = volumes.filter((volume) => volume.center.distanceTo(shoulder) < reach + volume.radii.length())
  const trials = Array.from({ length: 2 * steps + 1 }, (_, offset) =>
    clamp(near + (offset - steps) * step, -limit, limit),
  )
  const trialCost = (trial: number) => {
    const arm = settleMitten(settled, shoulder, center, bat.axis, pole, trial)
    const posed = { elbow: arm.elbow, wrist: arm.wrist, center }
    const depth = armCollisionDepth(posed, shoulder, bat.knob, bat.axis, around, other)
    const away = neighbours.reduce((sum, { swivel, change }) => sum + ((trial - swivel) / change) ** 2, 0)
    return { cost: weight * (trial / 45) ** 2 + (depth / depthScale) ** 2 + away, depth }
  }
  // Most searches hit nothing at the trial nearest the cost's lowest point: then it is the grid's best, and fitting it
  // and its neighbours lands where trying the whole grid would.
  const lowest = steps + Math.round((smoothestSwivel(neighbours, weight) - near) / step)
  const nearestOffsets = aroundLowest(trials, lowest, limit)
  const nearest = nearestOffsets.map((offset) => trialCost(trials[offset]))
  if (bestOfGrid(nearest)) {
    const [before, at, after] = nearest.map(({ cost }) => cost)
    return clamp(near + (lowest - steps + parabolaOffset(before, at, after)) * step, -limit, limit)
  }
  // Else the whole grid, the three already tried not tried again.
  const costs = trials.map((trial, offset) => nearest[nearestOffsets.indexOf(offset)]?.cost ?? trialCost(trial).cost)
  const best = costs.indexOf(Math.min(...costs))
  const inside = best > 0 && best < costs.length - 1
  const refined = inside ? parabolaOffset(costs[best - 1], costs[best], costs[best + 1]) : 0
  return clamp(near + (best - steps + refined) * step, -limit, limit)
}

const placeShoulder = new Vector3()
const forearm = new Vector3()
const long = new Vector3()
const across = new Vector3()

/**
 * Puts mitten `index` on the handle at `center`, its arm reaching the wrist point inside it with the elbow swivelled
 * `swivel` degrees off `pole`, then turns the mitten along the forearm the arm reached with, so its bend never passes
 * the cap even while the bat whips round faster than the settling rounds converge.
 */
export function placeMitten(
  rig: BallplayerRig,
  mitten: Group,
  index: number,
  center: Vector3,
  axis: Vector3,
  pole: Vector3,
  swivel: number,
) {
  const shoulder = shoulderPoint(rig, index, placeShoulder)
  const arm = settleMitten(settled, shoulder, center, axis, pole, swivel)
  reachArm(rig, index, arm.wrist, arm.pole)
  forearm.copy(arm.wrist).sub(rig.elbows[index]).normalize()
  mittenAxis(long, forearm, axis)
  across.copy(axis).addScaledVector(long, -axis.dot(long))
  if (across.lengthSq() < 1e-8) across.set(1, 0, 0)
  basis(mitten.quaternion, across.normalize(), long)
  mitten.position.copy(center)
}

const reachAxis = new Vector3()

/** Mitten-frame `local` for mitten `index` (the bottom one is mirrored) turned by `turn`. */
export function mittenVector(out: Vector3, local: Vector3, index: number, turn: Quaternion) {
  out.copy(local)
  out.x *= index === 1 ? -1 : 1
  return out.applyQuaternion(turn)
}

/**
 * How far a mitten turned `turn` reaches from the handle along `axis` toward `side` (+1 the barrel, -1 the knob): its
 * half extent as an ellipsoid with the mitten's half-axes, plus its center's offset along the bat and 3 mm for the
 * capsule's fuller ends.
 */
export function mittenReach(turn: Quaternion, index: number, axis: Vector3, side: number) {
  const acrossBat = mittenVector(reachAxis, ACROSS, index, turn).dot(axis)
  const thickness = mittenVector(reachAxis, PALM_SIDE, index, turn).dot(axis)
  const along = mittenVector(reachAxis, ALONG_FOREARM, index, turn).dot(axis)
  const extent = Math.hypot(MITTEN.wide * acrossBat, MITTEN.thick * thickness, MITTEN.long * along)
  return extent + side * MITTEN.center * along + 0.003
}

const slidTop = new Vector3()

/**
 * Both mittens on the bat, the bottom one (the front arm's) first. A tipped mitten reaches further along the bat (most
 * in the roll-over), so the top one slides up the handle until they touch instead of overlapping.
 */
export function placeMittens(
  rig: BallplayerRig,
  mittens: [Group, Group],
  grip: { bottom: Vector3; top: Vector3; axis: Vector3 },
  poles: [Vector3, Vector3],
  swivels: [number, number],
) {
  const { bottom, top, axis } = grip
  placeMitten(rig, mittens[1], 1, bottom, axis, poles[1], swivels[1])
  placeMitten(rig, mittens[0], 0, top, axis, poles[0], swivels[0])
  const needed =
    mittenReach(mittens[1].quaternion, 1, axis, 1) + mittenReach(mittens[0].quaternion, 0, axis, -1) + 0.004
  const spacing = slidTop.copy(top).sub(bottom).dot(axis)
  if (needed <= spacing + 1e-4) return
  placeMitten(rig, mittens[0], 0, slidTop.copy(top).addScaledVector(axis, needed - spacing), axis, poles[0], swivels[0])
}
