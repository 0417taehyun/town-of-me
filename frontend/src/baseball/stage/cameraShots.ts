import { type PerspectiveCamera, Vector3 } from 'three'
import { dampingAlpha } from '../../camera/cameraMath'
import type { Vec3 } from '../../data/models'
import { clamp, damp } from '../../motionMath'
import type { PitchResult } from '../game/derbyScore'
import { type BattingSide, FENCE_HEIGHT, fenceDistance, STRIKE_ZONE } from '../game/field'
import { sprayPoint } from '../game/flight'
import { RELEASE_POINT } from '../game/pitch'
import { MOUND } from '../stadium/fieldLayout'
import { batterSpot, PITCHER_SPOT, PLAYER_HEIGHT } from './stageLayout'

// The derby's camera. The batting shot looks straight down the pitch line from above the catcher, so the ball comes at
// the visitor the way it comes at the webcam they face. A batted ball is chased from low behind home plate; a run's
// showcase home runs (its first, and each one longer than every earlier one) also cut to a landing camera at the top of
// their flight.

export type ShotKind = 'batting' | 'chase' | 'wide'

/** Where the camera stands and looks, and how fast (per second) it eases there from where it was. */
export type CameraShot = { kind: ShotKind; position: Vec3; look: Vec3; fov: number; rate: number; lookRate: number }

/**
 * Where the HUD keeps clear of the batting shot, as shares of the screen's height: the bands at the top and the bottom,
 * which the shot plays between, and `centre` on either side of the pitch line (the band's centre), which the HUD's top
 * corners never cross though they hang below the top band, so the pitcher and his windup stay in view.
 */
export const HUD_RESERVE = { top: 0.15, bottom: 0.08, centre: 0.06 }
/** The share of the screen's width kept clear on either side of the play. */
export const SIDE_RESERVE = 0.05
export const BATTING_EYE: Vec3 = { x: 0, y: 3.5, z: 4.8 }
/** Radians of room kept beyond the highest and lowest points of the batting shot. */
export const FRAME_MARGIN = 0.02
/** The landing camera stands beyond where the ball comes down, off to the side of its path toward center field. */
export const LANDING_CAMERA = { beyond: 24, aside: 16, height: 10, fov: 50 }

/**
 * What the batting shot must show: the pitcher and his windup, the strike zone, home plate, the batter. The catcher
 * crouches far enough back (stageLayout.ts CATCHER_SPOT) that only his head shows, under the plate.
 */
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
 * The chase camera stands `behind` home plate (m), `height` up, drifting `drift` of the ball's way sideways up to
 * `driftLimit`; it tilts up after a rising ball no further than `highestTilt` (radians), so the field and the hedge
 * stay in view, unless the ball would climb more than `ballAbove` of the half screen over the middle.
 */
export const CHASE_CAMERA = {
  behind: 8,
  height: 3.5,
  drift: 0.1,
  driftLimit: 3,
  fov: 56,
  highestTilt: 0.26,
  ballAbove: 0.25,
}

/**
 * Low behind home plate, looking out at a batted ball with the field under it, a little late. It never leaves home
 * plate's side of the field, so a hit is not watched over the pitcher's back nor a foul from on top of a dugout.
 */
export function chaseShot(ball: Vec3): CameraShot {
  const { behind, height, drift, driftLimit, fov, highestTilt, ballAbove } = CHASE_CAMERA
  const position = { x: clamp(ball.x * drift, -driftLimit, driftLimit), y: height, z: behind }
  const across = Math.hypot(ball.x - position.x, ball.z - position.z)
  const elevation = Math.atan2(ball.y - height, across)
  const tilt = Math.max(Math.min(elevation, highestTilt), elevation - ballAbove * ((fov * Math.PI) / 360))
  return {
    kind: 'chase',
    position,
    look: { x: ball.x, y: height + Math.tan(tilt) * across, z: ball.z },
    fov,
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

/**
 * The camera's eased look point, the shot it last took, and how far (px) right of the screen's centre it draws the
 * picture's centre.
 */
export type CameraRig = { look: Vector3; kind: ShotKind | null; shift: number }

export function createCameraRig(): CameraRig {
  return { look: new Vector3(), kind: null, shift: 0 }
}

/** The part of the screen's width left for the play beside the camera panel, in px: its centre and width. */
export type FreeBand = { centre: number; width: number }

/** How fast (per second) the picture slides to a new band, as fast as a shot eases. */
export const BAND_RATE = 4

/**
 * Draws the picture of a `width` × `height` screen centred in `band`, the part the camera panel leaves free, sliding
 * there rather than jumping when the panel changes, or jumping with reduced motion. Give the shots `band`'s aspect so
 * the play fits its width.
 */
export function centreInBand(
  camera: PerspectiveCamera,
  rig: CameraRig,
  band: FreeBand,
  width: number,
  height: number,
  delta: number,
  reducedMotion: boolean,
) {
  const target = band.centre - width / 2
  rig.shift = reducedMotion ? target : damp(rig.shift, target, BAND_RATE, delta)
  camera.setViewOffset(width, height, -rig.shift, 0, width, height)
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
