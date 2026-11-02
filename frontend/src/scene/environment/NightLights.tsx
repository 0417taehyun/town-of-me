import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, BackSide, Vector3, type Points, type PointsMaterial } from 'three'
import type { MutableRefObject } from 'react'
import {
  advanceAtmosphereTime,
  createStarField,
  FIREFLY_COUNT,
  getFireflyGlow,
  setFireflyPosition,
  STAR_COUNT,
} from './atmosphereMotion'
import { createDayLighting, writeDayLighting, type DayChange } from './dayTransition'
import { damp } from '../../motionMath'
import { getGlowTexture } from '../glowTexture'
import { seasonClock, type SeasonChange } from './seasonTransition'

/** Fireflies gather this far ahead of the camera, around the player. */
const FIREFLY_LOOK_AHEAD = 12

/** Stars on the inside of the sky dome; place them in the group that follows the camera. */
export function Stars({ dayChange }: { dayChange: MutableRefObject<DayChange> }) {
  const points = useRef<Points>(null)
  const material = useRef<PointsMaterial>(null)
  const lighting = useMemo(() => createDayLighting(), [])
  const field = useMemo(() => createStarField(STAR_COUNT, 200), [])
  useFrame(() => {
    if (!points.current || !material.current) return
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    points.current.visible = lighting.night > 0.01
    material.current.opacity = lighting.night
  })
  return (
    <points ref={points} frustumCulled={false} renderOrder={-1}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[field.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[field.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        map={getGlowTexture()}
        size={3.2}
        sizeAttenuation={false}
        vertexColors
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        fog={false}
        toneMapped={false}
        // Back-sided like the sky dome, so the world curve does not sink the stars below the horizon.
        side={BackSide}
      />
    </points>
  )
}

/** Fireflies over the grass on summer evenings; they drift and blink on the ambient clock. */
export function Fireflies({
  dayChange,
  seasonChange,
  reducedMotion,
  motionEnabled,
  editing,
}: {
  dayChange: MutableRefObject<DayChange>
  seasonChange: MutableRefObject<SeasonChange>
  reducedMotion: boolean
  motionEnabled: boolean
  editing: boolean
}) {
  const points = useRef<Points>(null)
  const material = useRef<PointsMaterial>(null)
  const lighting = useMemo(() => createDayLighting(), [])
  const buffers = useMemo(
    () => ({ positions: new Float32Array(FIREFLY_COUNT * 3), glows: new Float32Array(FIREFLY_COUNT * 3) }),
    [],
  )
  const firefly = useMemo(() => new Vector3(), [])
  const center = useMemo(() => new Vector3(), [])
  const elapsed = useRef(0)
  // Eased separately from the day change so fireflies also come and go gently when the season changes.
  const presence = useRef(0)
  useFrame(({ camera }, delta) => {
    const swarm = points.current
    if (!swarm || !material.current) return
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    const target = lighting.night * Number(seasonChange.current.to === 'summer')
    presence.current = damp(presence.current, target, 1.5, Math.min(delta, 0.1))
    swarm.visible = presence.current > 0.01
    if (!swarm.visible) return
    material.current.opacity = presence.current
    elapsed.current = editing ? 0 : advanceAtmosphereTime(elapsed.current, delta, reducedMotion, motionEnabled)
    camera.getWorldDirection(center).setY(0).normalize().multiplyScalar(FIREFLY_LOOK_AHEAD).add(camera.position)
    for (let index = 0; index < FIREFLY_COUNT; index += 1) {
      setFireflyPosition(firefly, index, elapsed.current, center.x, center.z)
      firefly.toArray(buffers.positions, index * 3)
      buffers.glows.fill(getFireflyGlow(index, elapsed.current, reducedMotion), index * 3, index * 3 + 3)
    }
    swarm.geometry.attributes.position.needsUpdate = true
    swarm.geometry.attributes.color.needsUpdate = true
  })
  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[buffers.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[buffers.glows, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={material}
        map={getGlowTexture()}
        color="#e8ff8a"
        size={0.55}
        vertexColors
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        fog={false}
        toneMapped={false}
      />
    </points>
  )
}
