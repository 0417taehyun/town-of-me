import { seededFraction } from '../../../motionMath'
import {
  MathUtils,
  Vector3,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three'

import { FOUNTAIN_WATER_LEVEL } from './fountainLayout'
import { writeInstanceMatrices } from '../../instancedMeshes'

const JETS = 3
const DROPS_PER_JET = 24
export const FOUNTAIN_DROPS = JETS * DROPS_PER_JET
export const FOUNTAIN_RIPPLES = 4
export const FOUNTAIN_SURFACE_SPARKLES = 6
export const FOUNTAIN_JET_SPARKLES = 3
export const FOUNTAIN_ICICLES = 7

/** The top of the column, where the jets leave it. */
const JET_TOP = 1.6
const LAUNCHES_PER_SECOND = 0.7
/** Share of a sparkle's cycle spent glinting; it is gone for the rest. */
const GLINT_SHARE = 0.35
/** How far icicles lean out from the column, which widens below its lip. */
const ICICLE_TILT = 0.3
export const RIPPLE_OPACITY = 0.34
const ICE_OPACITY = 0.94

const up = new Vector3(0, 1, 0)
const ahead = new Vector3()
const hanging = new Vector3()

/** The jet slows and the basin freezes while the snow cover passes half, and both reverse as the snow melts. */
export function getFountainFlow(snowCover: number) {
  return 1 - MathUtils.smoothstep(snowCover, 0.4, 0.6)
}

export const getJetPressure = (flow: number) => 0.35 + 0.65 * flow

// Whatever the pressure, the arc leaves the column top and lands on the water at progress 1.
export function setArcPoint(point: Vector3, heading: number, pressure: number, progress: number) {
  const rise = 3.4 * pressure
  const fall = rise + JET_TOP - FOUNTAIN_WATER_LEVEL
  const outward = 1.6 * pressure * progress
  return point.set(
    Math.cos(heading) * outward,
    JET_TOP + rise * progress - fall * progress ** 2,
    Math.sin(heading) * outward,
  )
}

/**
 * Each launch takes its own heading, pressure, and size, so the jets spray instead of threading beads, and each drop
 * stretches along its flight, longest where it falls fastest. A weaker `flow` lowers the arcs and shrinks the drops
 * until the jet stops.
 */
export function setFountainDrop(dummy: Object3D, index: number, elapsed: number, flow = 1) {
  const launchClock =
    elapsed * LAUNCHES_PER_SECOND + ((index % DROPS_PER_JET) + seededFraction(index, 41) * 0.9) / DROPS_PER_JET
  const progress = launchClock % 1
  const launch = Math.floor(launchClock) * FOUNTAIN_DROPS + index
  const heading = (Math.floor(index / DROPS_PER_JET) * Math.PI * 2) / JETS + (seededFraction(launch, 42) - 0.5) * 0.24
  const pressure = (0.9 + seededFraction(launch, 43) * 0.18) * getJetPressure(flow)
  setArcPoint(dummy.position, heading, pressure, progress)
  const step = setArcPoint(ahead, heading, pressure, progress + 0.01).sub(dummy.position)
  const speed = step.length() / 0.01
  dummy.quaternion.setFromUnitVectors(up, step.normalize())
  const size = (0.85 + seededFraction(launch, 44) * 0.3) * flow
  dummy.scale.set(0.045 * size, (0.05 + 0.022 * speed) * size, 0.045 * size)
}

export function setFountainRipple(dummy: Object3D, index: number, elapsed: number) {
  const progress = (elapsed * 0.3 + index / FOUNTAIN_RIPPLES) % 1
  const radius = 0.36 + progress * 1.62
  dummy.position.set(0, FOUNTAIN_WATER_LEVEL, 0)
  dummy.rotation.set(-Math.PI / 2, 0, 0)
  dummy.scale.set(radius, radius, 1)
}

export const getGlint = (phase: number) => Math.sin(Math.PI * Math.min(phase / GLINT_SHARE, 1))

export function setGlint(dummy: Object3D, size: number) {
  dummy.rotation.set(0, Math.PI / 4, 0)
  dummy.scale.set(size, size * 1.8, size)
}

/** Each glint winks at a fresh spot on the water (or the ice), so the basin twinkles without a pattern. */
export function setFountainSurfaceSparkle(dummy: Object3D, index: number, elapsed: number) {
  const clock = elapsed * 0.45 + seededFraction(index, 51)
  const spot = Math.floor(clock) * FOUNTAIN_SURFACE_SPARKLES + index
  const angle = seededFraction(spot, 52) * Math.PI * 2
  const radius = 0.55 + seededFraction(spot, 53) * 1.4
  dummy.position.set(Math.cos(angle) * radius, FOUNTAIN_WATER_LEVEL + 0.03, Math.sin(angle) * radius)
  setGlint(dummy, 0.06 * getGlint(clock % 1))
}

/** Glints catch the rising streams just above the column and go out with the jet. */
export function setFountainJetSparkle(dummy: Object3D, index: number, elapsed: number, flow: number) {
  const clock = elapsed * 0.8 + seededFraction(index, 61)
  const spot = Math.floor(clock) * FOUNTAIN_JET_SPARKLES + index
  const heading = (Math.floor(seededFraction(spot, 62) * JETS) * Math.PI * 2) / JETS
  setArcPoint(dummy.position, heading, getJetPressure(flow), 0.06 + seededFraction(spot, 63) * 0.3)
  setGlint(dummy, 0.055 * getGlint(clock % 1) * flow)
}

/** Icicles hang from the column's lip and grow as the basin freezes. */
export function setFountainIcicle(dummy: Object3D, index: number, ice: number) {
  const angle = ((index + seededFraction(index, 71) * 0.4) / FOUNTAIN_ICICLES) * Math.PI * 2
  const length = (0.16 + seededFraction(index, 72) * 0.24) * ice
  hanging.set(Math.cos(angle) * Math.sin(ICICLE_TILT), -Math.cos(ICICLE_TILT), Math.sin(angle) * Math.sin(ICICLE_TILT))
  dummy.quaternion.setFromUnitVectors(up, hanging)
  dummy.position.set(Math.cos(angle) * 0.28, JET_TOP, Math.sin(angle) * 0.28).addScaledVector(hanging, length / 2)
  dummy.scale.set(0.045 * ice, length, 0.045 * ice)
}

// Two slow, crossing wave trains on the basin's disc, each bent by the other; where both crest, a soft highlight drifts
// across the water, the way light catches a fountain's stirred surface.
const shimmerFragment = /* glsl */ `
#include <color_fragment>
{
  vec2 spot = vWaterSpot * 3.0;
  float waves = sin( spot.x * 1.7 + waterTime * 1.3 + sin( spot.y * 1.3 - waterTime * 0.9 ) )
    + sin( spot.y * 2.1 - waterTime * 1.1 + sin( spot.x * 1.2 + waterTime * 0.7 ) );
  diffuseColor.rgb *= 1.0 + 0.035 * waves * waterFlow;
  diffuseColor.rgb += smoothstep( 1.25, 1.9, waves ) * 0.14 * waterFlow;
}`

export type WaterShimmer = { waterTime: { value: number }; waterFlow: { value: number } }

/** Adds a gentle moving shimmer to the basin's water; its owner advances `waterTime` and stills it with `waterFlow`. */
export function addWaterShimmer(shader: WebGLProgramParametersWithUniforms, shimmer: WaterShimmer) {
  Object.assign(shader.uniforms, shimmer)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vWaterSpot;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterSpot = position.xy;')
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      '#include <common>\nuniform float waterTime;\nuniform float waterFlow;\nvarying vec2 vWaterSpot;',
    )
    .replace('#include <color_fragment>', shimmerFragment)
}

export function updateDrops(drops: InstancedMesh | null, dummy: Object3D, elapsed: number, flow: number) {
  if (!drops) return
  writeInstanceMatrices(drops, dummy, FOUNTAIN_DROPS, (drop, index) => setFountainDrop(drop, index, elapsed, flow))
  drops.visible = flow > 0
}

export function updateRipples(
  ripples: InstancedMesh | null,
  material: MeshBasicMaterial | null,
  dummy: Object3D,
  elapsed: number,
  flow: number,
) {
  if (!ripples || !material) return
  writeInstanceMatrices(ripples, dummy, FOUNTAIN_RIPPLES, (ripple, index) => setFountainRipple(ripple, index, elapsed))
  ripples.visible = flow > 0
  material.opacity = RIPPLE_OPACITY * flow
}

/** The basin's glints come first in `sparkles`, then the jets'. */
export function updateSparkles(sparkles: InstancedMesh | null, dummy: Object3D, elapsed: number, flow: number) {
  writeInstanceMatrices(sparkles, dummy, FOUNTAIN_SURFACE_SPARKLES, (sparkle, index) =>
    setFountainSurfaceSparkle(sparkle, index, elapsed),
  )
  writeInstanceMatrices(
    sparkles,
    dummy,
    FOUNTAIN_JET_SPARKLES,
    (sparkle, index) => setFountainJetSparkle(sparkle, index, elapsed, flow),
    FOUNTAIN_SURFACE_SPARKLES,
  )
}

export function updateIce(
  surface: Mesh | null,
  material: MeshStandardMaterial | null,
  icicles: InstancedMesh | null,
  dummy: Object3D,
  ice: number,
) {
  if (!surface || !material || !icicles) return
  writeInstanceMatrices(icicles, dummy, FOUNTAIN_ICICLES, (icicle, index) => setFountainIcicle(icicle, index, ice))
  surface.visible = ice > 0
  icicles.visible = ice > 0
  material.opacity = ICE_OPACITY * ice
}
