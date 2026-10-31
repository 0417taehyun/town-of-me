import { type PerspectiveCamera, Vector3 } from 'three'
import { dampingAlpha } from '../../camera/cameraMath'
import type { Vec3 } from '../../data/models'
import { clamp, damp } from '../../motionMath'
import type { PitchResult } from '../game/derbyScore'
import { type BattingSide, FENCE_HEIGHT, fenceDistance, STRIKE_ZONE } from '../game/field'
import { sprayPoint } from '../game/flight'
import { RELEASE_POINT } from '../game/pitch'
import { MOUND } from '../stadium/fieldLayout'
import { batterSpot, CATCHER_SPOT, PITCHER_SPOT, PLAYER_HEIGHT } from './stageLayout'

// The derby's camera. The batting shot looks straight down the pitch line from above the catcher, so the ball comes at
// the visitor the way it comes at the webcam they face. A batted ball is chased from behind; a run's showcase home runs
// (its first, and each one longer than every earlier one) also cut to a landing camera at the top of their flight.

export type ShotKind = 'batting' | 'chase' | 'wide'

/** Where the camera stands and looks, and how fast (per second) it eases there from where it was. */
export type CameraShot = { kind: ShotKind; position: Vec3; look: Vec3; fov: number; rate: number; lookRate: number }

/** The share of the screen's height the HUD keeps at the top and the bottom; the batting shot plays between them. */
export const HUD_RESERVE = { top: 0.15, bottom: 0.08 }
/** The share of the screen's width kept clear on either side of the play. */
export const SIDE_RESERVE = 0.05
export const BATTING_EYE: Vec3 = { x: 0, y: 3.5, z: 4.8 }
/** Radians of room kept beyond the highest and lowest points of the batting shot. */
export const FRAME_MARGIN = 0.02
/** The landing camera stands beyond where the ball comes down, off to the side of its path toward center field. */
export const LANDING_CAMERA = { beyond: 24, aside: 16, height: 10, fov: 50 }

/** What the batting shot must show: the pitcher and his windup, the strike zone, the batter, the catcher's cap. */
export function battingFramePoints(side: BattingSide): Vec3[] {
  const batter = batterSpot(side)
  const { bottom, top, halfWidth } = STRIKE_ZONE
  return [
    { x: 0, y: MOUND.height - 0.05, z: PITCHER_SPOT.z },
    { x: 0, y: PITCHER_SPOT.y + PLAYER_HEIGHT + 0.15, z: PITCHER_SPOT.z },
    RELEASE_POINT,
    { x: -halfWidth, y: bottom - 0.08, z: 0 },
    { x: halfWidth, y: top + 0.12, z: 0 },
    { x: 0, y: 0, z: 0.215 },
    { x: batter.x, y: 0, z: 0 },
    { x: batter.x, y: PLAYER_HEIGHT + 0.1, z: 0 },
    { x: batter.x * 1.9, y: 1.5, z: 0.3 },
    { x: 0, y: 1.45, z: CATCHER_SPOT.z + 0.1 },
  ]
}

/**
 * The batting shot for a screen `aspect` wide: tilted and zoomed so the highest of the frame points sits at the top
 * reserve's edge and the lowest at the bottom's, and wide enough for every point to clear the sides.
 */
export function battingShot(aspect: number, side: BattingSide): CameraShot {
  const eye = BATTING_EYE
  const points = battingFramePoints(side)
  const elevations = points.map((point) => Math.atan2(point.y - eye.y, eye.z - point.z))
  const highest = Math.max(...elevations) + FRAME_MARGIN
  const lowest = Math.min(...elevations) - FRAME_MARGIN
  const topSpan = 1 - 2 * HUD_RESERVE.top
  const above = tangentAboveAxis(highest - lowest, topSpan, 1 - 2 * HUD_RESERVE.bottom)
  const tilt = highest - Math.atan(above)
  const across = Math.max(...points.map((point) => Math.abs(point.x - eye.x) / depthAlong(point, eye, tilt)))
  const halfTangent = Math.max(above / topSpan, across / (aspect * (1 - 2 * SIDE_RESERVE)))
  return {
    kind: 'batting',
    position: { ...eye },
    look: { x: eye.x, y: eye.y + Math.sin(tilt) * 10, z: eye.z - Math.cos(tilt) * 10 },
    fov: (2 * Math.atan(halfTangent) * 180) / Math.PI,
    rate: 4,
    lookRate: 4,
  }
}

/**
 * The tangent of the angle between the camera's axis and the top of a vertical spread of `span` radians, when the
 * spread's top lands at `topSpan` and its bottom at `-bottomSpan` of the half screen: the root of
 * bottomSpan·s·a² + (topSpan + bottomSpan)·a − topSpan·s = 0, with s = tan(span).
 */
export function tangentAboveAxis(span: number, topSpan: number, bottomSpan: number) {
  const spanTangent = Math.tan(span)
  const sum = topSpan + bottomSpan
  const root = Math.sqrt(sum * sum + 4 * topSpan * bottomSpan * spanTangent * spanTangent)
  return (root - sum) / (2 * bottomSpan * spanTangent)
}

/** How far ahead of a camera at `eye`, looking toward the pitcher tilted by `tilt`, `point` is. */
export function depthAlong(point: Vec3, eye: Vec3, tilt: number) {
  return (point.y - eye.y) * Math.sin(tilt) + (eye.z - point.z) * Math.cos(tilt)
}

/**
 * Behind and above a batted ball, a little late, rising as it climbs. It stays between the foul lines, so a foul
 * pulled or pushed toward a dugout is watched from behind home plate rather than from on top of the dugout.
 */
export function chaseShot(ball: Vec3): CameraShot {
  const z = 11 + ball.z * 0.3
  const fairWidth = Math.max(0, -z)
  return {
    kind: 'chase',
    position: { x: clamp(ball.x * 0.3, -fairWidth, fairWidth), y: clamp(4 + ball.y * 0.45, 4, 26), z },
    look: { ...ball },
    fov: 52,
    rate: 3,
    lookRate: 7,
  }
}

/** The landing camera for a ball coming down `distance` m out at `spray`: it faces the ball as it clears the hedge. */
export function wideShot(spray: number, distance: number): CameraShot {
  const landing = sprayPoint(spray, distance)
  const fence = sprayPoint(spray, fenceDistance(spray))
  const outward = { x: Math.sin(spray), z: -Math.cos(spray) }
  const towardCenter = spray > 0 ? -1 : 1
  const { beyond, aside, height, fov } = LANDING_CAMERA
  return {
    kind: 'wide',
    position: {
      x: landing.x + outward.x * beyond + Math.cos(spray) * aside * towardCenter,
      y: height,
      z: landing.z + outward.z * beyond + Math.sin(spray) * aside * towardCenter,
    },
    // Halfway between the ball clearing the hedge (a few meters over it) and the ball on the grass.
    look: { x: (fence.x + landing.x) / 2, y: (FENCE_HEIGHT + 3) / 2, z: (fence.z + landing.z) / 2 },
    fov,
    rate: 2,
    lookRate: 2,
  }
}

/** A run's first home run, and each one longer than every earlier one, get the slow motion and the landing camera. */
export function isShowcaseHomeRun(earlier: readonly PitchResult[], result: PitchResult) {
  if (result.outcome !== 'homeRun') return false
  return earlier.every((pitch) => pitch.outcome !== 'homeRun' || pitch.distanceDecimetres < result.distanceDecimetres)
}

/** The camera's eased look point and the shot it last took. */
export type CameraRig = { look: Vector3; kind: ShotKind | null }

export function createCameraRig(): CameraRig {
  return { look: new Vector3(), kind: null }
}

const shotTarget = new Vector3()

/**
 * Eases `camera` toward `shot`. A new shot cuts instead, except the chase, which pulls away from the batting shot:
 * the landing camera, and the batting shot when a batted ball's show is over, jump straight there.
 */
export function aimCamera(camera: PerspectiveCamera, rig: CameraRig, shot: CameraShot, delta: number) {
  const cut = rig.kind !== shot.kind && shot.kind !== 'chase'
  rig.kind = shot.kind
  const { position, look } = shot
  camera.position.lerp(shotTarget.set(position.x, position.y, position.z), cut ? 1 : dampingAlpha(shot.rate, delta))
  rig.look.lerp(shotTarget.set(look.x, look.y, look.z), cut ? 1 : dampingAlpha(shot.lookRate, delta))
  camera.lookAt(rig.look)
  camera.fov = cut ? shot.fov : damp(camera.fov, shot.fov, shot.rate, delta)
  camera.updateProjectionMatrix()
}
