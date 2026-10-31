import {
  type BufferGeometry,
  CylinderGeometry,
  Euler,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { PlayerProfile } from '../../../data/playerProfile'
import { getAvatarAppearance } from '../../../scene/characters/avatarAppearance'
import { characterGeometries, mergeAvatarParts } from '../../../scene/characters/characterGeometries'
import { getRoundedBox } from '../../../scene/roundedBox'
import { solveTwoBone } from './twoBoneIk'

// The town character as a ballplayer: the procedural character's torso, head, legs, and colors in its proportions
// (scene/characters/ProceduralCharacter.tsx), posed by joints instead of a walk. A pelvis carries both legs, which
// reach their planted feet with two-bone IK, so the hips turn and sink without the feet sliding; the chest turns about
// a tilted spine, so the back shoulder dips as it turns, the way a swing plane does; the arms bend at the elbow, as
// thick as the pose lab's that the visitor chose, the forearm keeping its thickness into the hand.
//
// Everything is posed in the rig's frame, its root's own space: town units (about 2.1 tall), the origin between the
// feet, facing +z. Index 0 of a pair is the character's right side (-x), index 1 its left (+x).

export type AvatarAppearance = ReturnType<typeof getAvatarAppearance>
export type ElbowArm = { shoulder: Mesh; upper: Mesh; elbow: Mesh; forearm: Mesh }
type Pair<Item> = [Item, Item]

/** Where a foot is planted: the ball it pivots on (x, z), its lift, toe turn and heel lift (degrees), and its knee. */
export type FootPlacement = {
  x: number
  z: number
  lift: number
  yaw: number
  heel: number
  kneeAzimuth: number
  kneeFlexion: number
}

/** The pelvis's shift and turn over two planted feet; its height follows from the knees' flexion. */
export type LegStance = {
  pelvisX: number
  pelvisZ: number
  pelvisYaw: number
  pelvisTilt: number
  feet: Pair<FootPlacement>
}

export type BallplayerRig = {
  root: Group
  body: Group
  head: Group
  pelvis: Group
  legs: Pair<Group>
  knees: Pair<Group>
  feet: Pair<Group>
  arms: Pair<ElbowArm>
  appearance: AvatarAppearance
  /** The pelvis's turn and each ankle, elbow, and wrist, as last posed (rig frame). */
  pelvisTurn: Quaternion
  ankles: Pair<Vector3>
  elbows: Pair<Vector3>
  wrists: Pair<Vector3>
  /** One material per color and roughness, and the baked head: this rig's own, unlike the shared geometry. */
  materials: Map<string, MeshStandardMaterial>
  headGeometry: BufferGeometry
}

/**
 * The town character's measurements (rig units), read off its procedural model. They repeat ProceduralCharacter.tsx's
 * literals (as do buildLeg's and addCollar's) until the town character exports them (TODO.md); keep them in step.
 */
export const BALLPLAYER_BODY = {
  hipHeight: 0.73,
  hipHalfWidth: 0.17,
  thigh: 0.36,
  shin: 0.27,
  /** The waist sits this far above the hips, where the turned chest meets the pelvis. */
  waistUp: 0.08,
  headHeight: 1.67,
  /** Torso: a rounded box this size and rounding, centered this high. */
  torso: { width: 0.64, height: 0.64, depth: 0.38, rounding: 0.14, centerY: 1.04 },
}
/** Elbow-arm shoulders (body space): the town pivot (0.43, 1.25) moved 0.06 in and forward. */
export const SHOULDER = { x: 0.37, y: 1.25, z: 0.06 }
/** Shoulder to elbow and elbow to wrist, so the hands reach the batting research's grips. */
export const ARM_BONES = { upper: 0.37, fore: 0.35 }
/** The forearm keeps one thickness all the way into the hand, as in Animal Crossing (no thinner wrist). */
export const FOREARM_RADIUS = 0.06
/** The ball of the foot, which it pivots on, from the knee of a straight leg; and the ankle from there. */
export const TOE_PIVOT_IN_KNEE = new Vector3(0, -0.365, 0.205)
export const ANKLE_IN_FOOT = new Vector3(0, -BALLPLAYER_BODY.shin, 0).sub(TOE_PIVOT_IN_KNEE)

const { DEG2RAD } = MathUtils
const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const forearmGeometry = new CylinderGeometry(FOREARM_RADIUS, FOREARM_RADIUS, 1, 14)

export function rigMaterial(rig: Pick<BallplayerRig, 'materials'>, color: string, roughness: number) {
  const key = `${color}:${roughness}`
  const material = rig.materials.get(key) ?? new MeshStandardMaterial({ color, roughness })
  rig.materials.set(key, material)
  return material
}

export function addPart(
  rig: Pick<BallplayerRig, 'materials'>,
  parent: Group,
  geometry: BufferGeometry,
  color: string,
  roughness = 1,
) {
  const mesh = new Mesh(geometry, rigMaterial(rig, color, roughness))
  mesh.castShadow = true
  parent.add(mesh)
  return mesh
}

/** A rig for `profile`: the town character's look and colors, standing at its root with its arms at its sides. */
export function createBallplayerRig(profile: PlayerProfile): BallplayerRig {
  const appearance = getAvatarAppearance(profile)
  const root = new Group()
  const materials = new Map<string, MeshStandardMaterial>()
  const body = new Group()
  const head = new Group()
  const headGeometry = mergeAvatarParts(appearance.headParts)
  const owner = { materials }
  const { torso } = BALLPLAYER_BODY
  const torsoMesh = addPart(
    owner,
    body,
    getRoundedBox(torso.width, torso.height, torso.depth, torso.rounding),
    appearance.top,
  )
  torsoMesh.position.y = torso.centerY
  if (appearance.collar) [-1, 1].forEach((side) => addCollar(owner, body, side))
  head.position.y = BALLPLAYER_BODY.headHeight
  const headMesh = new Mesh(headGeometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }))
  materials.set('head', headMesh.material)
  headMesh.castShadow = true
  head.add(headMesh)
  body.add(head)
  const pelvis = new Group()
  const hips = addPart(
    owner,
    pelvis,
    getRoundedBox(appearance.relaxed ? 0.58 : 0.52, 0.24, 0.34, 0.1),
    appearance.bottom,
  )
  hips.position.y = 0.02
  const legs = [buildLeg(owner, appearance), buildLeg(owner, appearance)]
  const arms: Pair<ElbowArm> = [buildElbowArm(owner, root, appearance), buildElbowArm(owner, root, appearance)]
  root.add(body, pelvis, ...legs.flatMap(({ leg, foot }) => [leg, foot]))
  return {
    root,
    body,
    head,
    pelvis,
    legs: [legs[0].leg, legs[1].leg],
    knees: [legs[0].knee, legs[1].knee],
    feet: [legs[0].foot, legs[1].foot],
    arms,
    appearance,
    pelvisTurn: new Quaternion(),
    ankles: [new Vector3(), new Vector3()],
    elbows: [new Vector3(), new Vector3()],
    wrists: [new Vector3(), new Vector3()],
    materials,
    headGeometry,
  }
}

export function addCollar(owner: Pick<BallplayerRig, 'materials'>, body: Group, side: number) {
  const collar = addPart(owner, body, getRoundedBox(0.16, 0.12, 0.04, 0.015), '#eee6d5')
  collar.position.set(side * 0.09, 1.31, 0.21)
  collar.rotation.z = side * 0.35
  collar.castShadow = false
}

/** A town leg (thigh, and a knee with the shin) and its shoe in a foot of its own, pivoting on its ball. */
export function buildLeg(owner: Pick<BallplayerRig, 'materials'>, appearance: AvatarAppearance) {
  const leg = new Group()
  const knee = new Group()
  const foot = new Group()
  const { relaxed, boots } = appearance
  const thigh = addPart(owner, leg, getRoundedBox(relaxed ? 0.3 : 0.24, 0.36, 0.28, 0.08), appearance.bottom)
  thigh.position.y = -0.18
  knee.position.y = -BALLPLAYER_BODY.thigh
  const shinColor = appearance.shorts ? appearance.skin : appearance.bottom
  const shin = addPart(owner, knee, getRoundedBox(relaxed ? 0.27 : 0.21, 0.28, 0.24, 0.075), shinColor)
  shin.position.y = -0.14
  leg.add(knee)
  const shoe = addPart(
    owner,
    foot,
    getRoundedBox(0.27, boots ? 0.25 : 0.15, 0.41, boots ? 0.08 : 0.055),
    appearance.shoes,
    0.85,
  )
  shoe.position.set(0, -0.29 + (boots ? 0.05 : 0), 0.07).sub(TOE_PIVOT_IN_KNEE)
  return { leg, knee, foot }
}

/** Shoulder ball and upper arm in the sleeve's color; elbow and forearm in it too for long sleeves, else bare. */
export function buildElbowArm(owner: Pick<BallplayerRig, 'materials'>, root: Group, appearance: AvatarAppearance) {
  const sleeve = appearance.top
  const bare = appearance.longSleeves ? appearance.top : appearance.skin
  const shoulder = addPart(owner, root, characterGeometries.sphere, sleeve)
  shoulder.scale.setScalar(0.1)
  const upper = addPart(owner, root, getRoundedBox(0.185, ARM_BONES.upper, 0.185, 0.085), sleeve)
  const elbow = addPart(owner, root, characterGeometries.sphere, bare)
  elbow.scale.setScalar(0.07)
  const forearm = addPart(owner, root, forearmGeometry, bare)
  return { shoulder, upper, elbow, forearm }
}

/** Frees the rig's own materials and baked head; the shared geometry stays for the next rig. */
export function disposeBallplayerRig(rig: BallplayerRig) {
  rig.materials.forEach((material) => material.dispose())
  rig.headGeometry.dispose()
}

export function direction(azimuth: number, elevation: number, out: Vector3) {
  const turn = azimuth * DEG2RAD
  const lift = elevation * DEG2RAD
  return out.set(Math.sin(turn) * Math.cos(lift), Math.sin(lift), Math.cos(turn) * Math.cos(lift))
}

const tiltAxis = new Vector3()
const yawTurn = new Quaternion()

/** A spine tilted `forward` toward +z and `side` toward -x (degrees), then turned `yaw` degrees about itself. */
export function tiltYaw(out: Quaternion, forward: number, side: number, yaw: number) {
  tiltAxis.set(-Math.tan(side * DEG2RAD), 1, Math.tan(forward * DEG2RAD)).normalize()
  out.setFromUnitVectors(UP, tiltAxis)
  return out.multiply(yawTurn.setFromAxisAngle(UP, yaw * DEG2RAD))
}

const basisMatrix = new Matrix4()
const basisX = new Vector3()
const basisY = new Vector3()
const basisZ = new Vector3()

/** The rotation whose +y is `yAxis` and whose +z leans toward `zHint`. */
export function basis(out: Quaternion, yAxis: Vector3, zHint: Vector3) {
  basisY.copy(yAxis).normalize()
  basisZ.copy(zHint).addScaledVector(basisY, -zHint.dot(basisY))
  if (basisZ.lengthSq() < 1e-8) basisZ.set(basisY.y, -basisY.z, basisY.x).addScaledVector(basisY, -basisY.dot(basisZ))
  basisZ.normalize()
  basisX.crossVectors(basisY, basisZ)
  return out.setFromRotationMatrix(basisMatrix.makeBasis(basisX, basisY, basisZ))
}

/** Hip-to-ankle distance of a town leg bent `flexion` degrees at the knee. */
export function legSpan(flexion: number) {
  const { thigh, shin } = BALLPLAYER_BODY
  return Math.sqrt(thigh * thigh + shin * shin + 2 * thigh * shin * Math.cos(flexion * DEG2RAD))
}

const footTurn = new Euler()

/** Plants foot `index`, and keeps where its ankle ends up for the leg to reach. */
export function plantFoot(rig: BallplayerRig, index: number, placement: FootPlacement) {
  const foot = rig.feet[index]
  foot.position.set(placement.x, placement.lift, placement.z)
  foot.quaternion.setFromEuler(footTurn.set(placement.heel * DEG2RAD, placement.yaw * DEG2RAD, 0, 'YXZ'))
  rig.ankles[index].copy(ANKLE_IN_FOOT).applyQuaternion(foot.quaternion).add(foot.position)
}

/** Hip `index` from the pelvis's center, turned with it (rig frame). */
export function hipOffset(pelvisTurn: Quaternion, index: number, out: Vector3) {
  return out.set((index === 0 ? -1 : 1) * BALLPLAYER_BODY.hipHalfWidth, 0, 0).applyQuaternion(pelvisTurn)
}

const hipScratch = new Vector3()

/** Squared ground distance between hip `index` (pelvis at `pelvisX`, `pelvisZ`) and its ankle. */
export function hipToAnkleAcross(rig: BallplayerRig, stance: LegStance, index: number) {
  const hip = hipOffset(rig.pelvisTurn, index, hipScratch)
  const ankle = rig.ankles[index]
  return (stance.pelvisX + hip.x - ankle.x) ** 2 + (stance.pelvisZ + hip.z - ankle.z) ** 2
}

/**
 * The pelvis height that bends each planted leg closest to its knee flexion, the straighter leg counting more (the
 * front leg's brace at contact reads first); lowered where a leg could not reach its foot otherwise.
 */
export function pelvisHeight(rig: BallplayerRig, stance: LegStance) {
  const across = stance.feet.map((_, index) => hipToAnkleAcross(rig, stance, index))
  const hipLift = stance.feet.map((_, index) => hipOffset(rig.pelvisTurn, index, hipScratch).y)
  const weights = stance.feet.map(({ kneeFlexion }) => 1 / (kneeFlexion + 10))
  const heights = stance.feet.map(({ kneeFlexion }, index) => {
    const upright = Math.sqrt(Math.max(0, legSpan(kneeFlexion) ** 2 - across[index]))
    return rig.ankles[index].y - hipLift[index] + upright
  })
  const height = (heights[0] * weights[0] + heights[1] * weights[1]) / (weights[0] + weights[1])
  const reach = (BALLPLAYER_BODY.thigh + BALLPLAYER_BODY.shin) * 0.985
  const overreach = across.map(
    (squared, index) =>
      height + hipLift[index] - (rig.ankles[index].y + Math.sqrt(Math.max(0, reach * reach - squared))),
  )
  return height - Math.max(0, ...overreach)
}

const kneePole = new Vector3()
const kneePoint = new Vector3()
const reachedAnkle = new Vector3()
const boneDirection = new Vector3()
const shinTurn = new Quaternion()

/** Bends leg `index` from its hip on the posed pelvis to its ankle, the knee toward `kneeAzimuth`. */
export function bendLeg(rig: BallplayerRig, index: number, kneeAzimuth: number) {
  const leg = rig.legs[index]
  const hip = hipOffset(rig.pelvisTurn, index, leg.position).add(rig.pelvis.position)
  direction(kneeAzimuth, 0, kneePole)
  solveTwoBone(hip, rig.ankles[index], BALLPLAYER_BODY.thigh, BALLPLAYER_BODY.shin, kneePole, kneePoint, reachedAnkle)
  basis(leg.quaternion, boneDirection.copy(hip).sub(kneePoint), kneePole)
  basis(shinTurn, boneDirection.copy(kneePoint).sub(reachedAnkle), kneePole)
  rig.knees[index].quaternion.copy(leg.quaternion).invert().multiply(shinTurn)
}

/** Plants the feet, then sets the pelvis over them and bends both legs to reach them. */
export function poseLegs(rig: BallplayerRig, stance: LegStance) {
  stance.feet.forEach((placement, index) => plantFoot(rig, index, placement))
  tiltYaw(rig.pelvisTurn, stance.pelvisTilt, 0, stance.pelvisYaw)
  rig.pelvis.quaternion.copy(rig.pelvisTurn)
  rig.pelvis.position.set(stance.pelvisX, pelvisHeight(rig, stance), stance.pelvisZ)
  stance.feet.forEach((placement, index) => bendLeg(rig, index, placement.kneeAzimuth))
}

const chestTurn = new Quaternion()
const rollTurn = new Quaternion()
const headTurn = new Quaternion()
const headAngles = new Euler()
const waist = new Vector3()
const waistInBody = new Vector3()

/**
 * Turns the chest about its tilted spine (degrees: `tilt` forward, `side` toward -x, `yaw` about the spine, then `roll`
 * lifting the +x shoulder) on the posed pelvis, and the head to `headYaw` and `headPitch` (down) in the rig frame.
 */
export function poseChest(
  rig: BallplayerRig,
  chest: { yaw: number; tilt: number; side: number; roll: number },
  headYaw: number,
  headPitch: number,
) {
  const { body } = rig
  tiltYaw(chestTurn, chest.tilt, chest.side, chest.yaw).multiply(
    rollTurn.setFromAxisAngle(FORWARD, chest.roll * DEG2RAD),
  )
  body.quaternion.copy(chestTurn)
  waist.set(0, BALLPLAYER_BODY.waistUp, 0).applyQuaternion(rig.pelvisTurn).add(rig.pelvis.position)
  waistInBody.set(0, BALLPLAYER_BODY.hipHeight + BALLPLAYER_BODY.waistUp, 0).applyQuaternion(chestTurn)
  body.position.copy(waist).sub(waistInBody)
  body.updateMatrix()
  turnHead(rig, headYaw, headPitch)
}

/** Turns the head on the posed chest to `yaw` and `pitch` (down), degrees in the rig frame. */
export function turnHead(rig: Pick<BallplayerRig, 'body' | 'head'>, yaw: number, pitch: number) {
  headTurn.setFromEuler(headAngles.set(pitch * DEG2RAD, yaw * DEG2RAD, 0, 'YXZ'))
  rig.head.quaternion.copy(rig.body.quaternion).invert().multiply(headTurn)
  rig.head.updateMatrix()
}

/** Shoulder joint of arm `index` on the posed chest (rig frame). */
export function shoulderPoint(rig: BallplayerRig, index: number, out: Vector3) {
  return out.set((index === 0 ? -1 : 1) * SHOULDER.x, SHOULDER.y, SHOULDER.z).applyMatrix4(rig.body.matrix)
}

const shoulderJoint = new Vector3()
const upperBone = new Vector3()

/**
 * Elbow arm `index` reaching for `wrist` with its elbow toward `pole`, stretching evenly when it falls short: poses the
 * arm's meshes and keeps its elbow and wrist.
 */
export function reachArm(rig: BallplayerRig, index: number, wrist: Vector3, pole: Vector3) {
  const shoulder = shoulderPoint(rig, index, shoulderJoint)
  solveTwoBone(shoulder, wrist, ARM_BONES.upper, ARM_BONES.fore, pole, rig.elbows[index], rig.wrists[index], true)
  placeArm(rig, index, shoulder, pole)
}

/** Poses arm `index`'s meshes from `shoulder` through its elbow and wrist as last solved, bending toward `pole`. */
export function placeArm(rig: BallplayerRig, index: number, shoulder: Vector3, pole: Vector3) {
  const arm = rig.arms[index]
  const elbow = rig.elbows[index]
  const reached = rig.wrists[index]
  arm.shoulder.position.copy(shoulder)
  arm.upper.position.copy(shoulder).add(elbow).multiplyScalar(0.5)
  basis(arm.upper.quaternion, upperBone.copy(shoulder).sub(elbow), pole)
  arm.upper.scale.y = shoulder.distanceTo(elbow) / ARM_BONES.upper
  arm.elbow.position.copy(elbow)
  arm.forearm.position.copy(elbow).add(reached).multiplyScalar(0.5)
  basis(arm.forearm.quaternion, upperBone.copy(elbow).sub(reached), pole)
  arm.forearm.scale.y = elbow.distanceTo(reached)
}
