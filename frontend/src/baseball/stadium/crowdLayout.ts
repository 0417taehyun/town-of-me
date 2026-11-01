import {
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  type InstancedMesh,
  type Object3D,
  SphereGeometry,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { dampingAlpha } from '../../camera/cameraMath'
import type { PlayerProfile } from '../../data/playerProfile'
import { damp, seededFraction } from '../../motionMath'
import { glslFloat } from '../../scene/objects/foliageMaterial'
import type { PitchResult } from '../game/derbyScore'
import type { BallView } from '../stage/ballMeshes'
import type { Seat } from './bowlLayout'

// The crowd in the stands: small chibi fans, one instanced mesh for all of them, so the whole crowd is one draw call.
// Each fan's seat is its instance's place; its motion, turning toward what it watches, hopping and waving, runs in the
// vertex shader from a few uniforms, so a frame costs the main thread nothing per fan while the camera's pose task
// shares it.

/**
 * The share of the seats taken, and of those the fans a reduced-tier computer draws. `seatBack` is how far behind a
 * seat's front a fan sits (m), against its seat's back.
 */
export const CROWD = { share: 0.55, reducedShare: 0.5, seatBack: 0.3 }

/** A fan's body in fan space: +z ahead, the seat at the origin; its arms hang from the shoulders and swing out. */
export const FAN = { bodyY: 0.3, shoulderX: 0.29, shoulderY: 0.46, shoulderZ: 0.04, armHang: 0.2 }

/** Where the crowd looks while no ball is in sight: the infield. */
export const CROWD_REST_WATCH = [0, 1, -20] as const

/** Radians a fan turns from its seat's facing toward what it watches, at most. */
export const FAN_TURN = 1.1

/** Which color each part of a fan takes: its top, its skin, its hair or hat, or its eyes. */
export const FAN_PARTS = { top: 0, skin: 1, crown: 2, eyes: 3 }
export const FAN_EYES = '#352b29'

/**
 * The seats the crowd takes, in a seeded order in which every leading share is spread round the stands, so a
 * reduced-tier computer drawing only the first fans still fills the whole bowl.
 */
export function crowdSeats(seats: readonly Seat[]) {
  return seats
    .map((seat, index) => ({ seat, keep: seededFraction(index, 41), order: seededFraction(index, 59) }))
    .filter(({ keep }) => keep < CROWD.share)
    .sort((first, second) => first.order - second.order)
    .map(({ seat }) => seat)
}

/** How many of `total` fans to draw. */
export function crowdCount(total: number, reduced: boolean) {
  return reduced ? Math.round(total * CROWD.reducedShare) : total
}

/** A fan in its seat, sitting back against the seat's back and facing as the seat does. */
export function setFanSeat(dummy: Object3D, seat: Seat) {
  dummy.position.set(seat.x - Math.sin(seat.yaw) * CROWD.seatBack, seat.y, seat.z - Math.cos(seat.yaw) * CROWD.seatBack)
  dummy.rotation.set(0, seat.yaw, 0)
  dummy.scale.set(1, 1, 1)
}

/** A fan's colors from a look: its top, its skin, and its hat, else its hair, else a bald crown in its skin. */
export function fanColors(look: PlayerProfile) {
  const crown = look.hat !== 'none' ? look.colors.hat : look.hair !== 'none' ? look.colors.hair : look.colors.skin
  return { top: look.colors.top, skin: look.colors.skin, crown }
}

/** How much the crowd cheers a result: all out for a home run, a little for a hit, not at all otherwise. */
export function crowdCheer(result: PitchResult | null) {
  if (result?.outcome === 'homeRun') return 1
  return result?.outcome === 'hit' ? 0.45 : 0
}

/** A part of a fan's body: its geometry in fan space, which color it takes, and the arm's side (0 for no arm). */
export type FanPart = { geometry: BufferGeometry; part: number; arm: number }

export function fanParts(): FanPart[] {
  const { bodyY, shoulderX, shoulderY, shoulderZ, armHang } = FAN
  const eyes = [-1, 1].map((side) => ({
    geometry: new SphereGeometry(0.038, 4, 2).translate(side * 0.095, bodyY + 0.52, 0.27),
    part: FAN_PARTS.eyes,
    arm: 0,
  }))
  const arms = [-1, 1].map((side) => ({
    geometry: new CapsuleGeometry(0.075, 0.24, 1, 5).translate(side * shoulderX, shoulderY - armHang, shoulderZ),
    part: FAN_PARTS.top,
    arm: side,
  }))
  return [
    { geometry: new CapsuleGeometry(0.23, 0.12, 2, 8).scale(1.05, 1, 0.85).translate(0, bodyY, 0), part: 0, arm: 0 },
    { geometry: new SphereGeometry(0.27, 10, 7).translate(0, bodyY + 0.5, 0.02), part: FAN_PARTS.skin, arm: 0 },
    {
      geometry: new SphereGeometry(0.29, 10, 3, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, bodyY + 0.54, -0.01),
      part: FAN_PARTS.crown,
      arm: 0,
    },
    ...eyes,
    ...arms,
  ]
}

/** One fan as one geometry, each vertex marked with its part's color and its arm's side. */
export function createFanGeometry() {
  const parts = fanParts().map(({ geometry, part, arm }) => markPart(geometry, part, arm))
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  return merged
}

export function markPart(geometry: BufferGeometry, part: number, arm: number) {
  const count = geometry.getAttribute('position').count
  geometry.setAttribute('fanPart', new Float32BufferAttribute(new Float32Array(count).fill(part), 1))
  geometry.setAttribute('fanArm', new Float32BufferAttribute(new Float32Array(count).fill(arm), 1))
  return geometry
}

const scratch = new Color()

/** `geometry`'s per-fan attribute `name`, made for `count` fans the first time it is asked for. */
export function fanAttribute(geometry: BufferGeometry, name: string, itemSize: number, count: number) {
  const existing = geometry.getAttribute(name)
  if (existing instanceof InstancedBufferAttribute) return existing
  const attribute = new InstancedBufferAttribute(new Float32Array(count * itemSize), itemSize)
  geometry.setAttribute(name, attribute)
  return attribute
}

/**
 * Gives each of `looks`' fans its colors and its own liveliness (when it hops, how eagerly), on `mesh`'s instances in
 * order.
 */
export function writeFanLooks(mesh: InstancedMesh, looks: readonly PlayerProfile[]) {
  const count = mesh.instanceMatrix.count
  const [top, skin, crown] = ['fanTop', 'fanSkin', 'fanCrown'].map((name) =>
    fanAttribute(mesh.geometry, name, 3, count),
  )
  const spirit = fanAttribute(mesh.geometry, 'fanSpirit', 2, count)
  looks.slice(0, count).forEach((look, index) => {
    const colors = fanColors(look)
    scratch.set(colors.top).toArray(top.array, index * 3)
    scratch.set(colors.skin).toArray(skin.array, index * 3)
    scratch.set(colors.crown).toArray(crown.array, index * 3)
    spirit.setXY(index, seededFraction(index, 83) * Math.PI * 2, 0.6 + seededFraction(index, 97) * 0.6)
  })
  ;[top, skin, crown, spirit].forEach((attribute) => {
    attribute.needsUpdate = true
  })
}

/** What the crowd shader reads each frame: seconds of motion, how much it cheers, and the point it watches. */
export function createCrowdUniforms() {
  return {
    crowdTime: { value: 0 },
    crowdCheer: { value: 0 },
    crowdWatch: { value: new Vector3(...CROWD_REST_WATCH) },
  }
}

export type CrowdUniforms = ReturnType<typeof createCrowdUniforms>

/** How fast (per second) the crowd's eyes follow the ball, and its cheer rises and dies down. */
export const CROWD_RATES = { watch: 3, cheerUp: 6, cheerDown: 1.5 }
const restWatch = new Vector3(...CROWD_REST_WATCH)

/**
 * Eases the crowd's eyes toward `view`'s ball (the infield while none is in sight) and its cheer toward `cheer` over
 * `delta` seconds, and runs its motion on `motionDelta` seconds (none under reduced motion).
 */
export function advanceCrowd(
  uniforms: CrowdUniforms,
  view: BallView | null,
  cheer: number,
  motionDelta: number,
  delta: number,
) {
  uniforms.crowdWatch.value.lerp(view?.visible ? view.position : restWatch, dampingAlpha(CROWD_RATES.watch, delta))
  const rate = cheer > uniforms.crowdCheer.value ? CROWD_RATES.cheerUp : CROWD_RATES.cheerDown
  uniforms.crowdCheer.value = damp(uniforms.crowdCheer.value, cheer, rate, delta)
  uniforms.crowdTime.value += motionDelta
}

const crowdVertexPars = /* glsl */ `
uniform float crowdTime;
uniform float crowdCheer;
uniform vec3 crowdWatch;
attribute float fanPart;
attribute float fanArm;
attribute vec3 fanTop;
attribute vec3 fanSkin;
attribute vec3 fanCrown;
attribute vec2 fanSpirit;
varying vec3 vFanColor;

vec3 fanYaw( vec3 point, float angle ) {
  float c = cos( angle );
  float s = sin( angle );
  return vec3( point.x * c + point.z * s, point.y, -point.x * s + point.z * c );
}

vec3 fanRoll( vec3 point, float angle ) {
  float c = cos( angle );
  float s = sin( angle );
  return vec3( point.x * c - point.y * s, point.x * s + point.y * c, point.z );
}

// From the seat's facing toward the watched point, as far as a seated fan turns.
float fanTurn() {
  vec2 toWatch = crowdWatch.xz - instanceMatrix[ 3 ].xz;
  vec3 ahead = instanceMatrix[ 2 ].xyz;
  float turn = atan( toWatch.x, toWatch.y ) - atan( ahead.x, ahead.z );
  return clamp( atan( sin( turn ), cos( turn ) ), -${glslFloat(FAN_TURN)}, ${glslFloat(FAN_TURN)} );
}

// Posed in fan space: arms swung out about the shoulder, the fan lifted by its hop, and turned toward what it watches.
// A normal turns with its vertex but is not lifted.
vec3 fanPose( vec3 point, float isPoint ) {
  float amount = min( 1.0, crowdCheer * fanSpirit.y );
  float raise = 0.18 + amount * ( 2.5 + sin( crowdTime * 18.0 + fanSpirit.x ) * 0.35 );
  vec3 shoulder = vec3( fanArm * ${glslFloat(FAN.shoulderX)}, ${glslFloat(FAN.shoulderY)}, ${glslFloat(FAN.shoulderZ)} );
  vec3 swung = shoulder * isPoint + fanRoll( point - shoulder * isPoint, fanArm * raise );
  vec3 posed = fanArm == 0.0 ? point : swung;
  float hop = max( 0.0, sin( crowdTime * 11.0 + fanSpirit.x ) ) * 0.3 * amount;
  float breath = sin( crowdTime * 1.7 + fanSpirit.x * 3.0 ) * 0.012;
  posed.y += ( hop + breath ) * isPoint;
  return fanYaw( posed, fanTurn() );
}

vec3 fanColor() {
  if ( fanPart < 0.5 ) return fanTop;
  if ( fanPart < 1.5 ) return fanSkin;
  if ( fanPart < 2.5 ) return fanCrown;
  return vec3( ${new Color(FAN_EYES)
    .toArray()
    .map((channel) => glslFloat(channel))
    .join(', ')} );
}`

/** Makes a standard material pose and color the crowd's fans (createFanGeometry, writeFanLooks) from `uniforms`. */
export function addCrowdShader(shader: WebGLProgramParametersWithUniforms, uniforms: CrowdUniforms) {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${crowdVertexPars}`)
    .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = fanPose( vec3( normal ), 0.0 );')
    .replace('#include <begin_vertex>', 'vec3 transformed = fanPose( vec3( position ), 1.0 );\nvFanColor = fanColor();')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFanColor;')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFanColor;')
}
