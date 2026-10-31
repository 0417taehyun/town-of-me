import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Object3D,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three'
import type { TownObject } from '../../../data/models'
import { advanceAtmosphereTime } from '../../environment/atmosphereMotion'
import type { SunPosition } from '../../environment/dayCycle'
import { createDayLighting, getDayChangeDuration, writeDayLighting } from '../../environment/dayTransition'
import { seasonClock } from '../../environment/seasonTransition'
import { addInstanceOpacity, createInstanceOpacities } from '../../instancedMeshes'
import type { TownLayerProps } from '../townObjectKind'
import {
  birdInstances,
  colorBirdParts,
  colorClouds,
  createShadowTexture,
  fadeBirds,
  fadeClouds,
  updateBirds,
  updateCloudShadows,
  updateClouds,
  writeCloudShadowSun,
} from './skyMeshes'
import {
  BIRD_BEAK_PARTS,
  BIRD_BODY_PARTS,
  BIRD_WING_PARTS,
  createBirdSpecs,
  createCloudSpecs,
  getActiveAtmosphereCounts,
  getCloudShadowOpacity,
  PUFFS_PER_CLOUD,
  stepAtmospherePresence,
} from './skyMotion'

// Birds are transparent only to fade in and out; drawn before the clouds, they still show behind them as when opaque.
const BIRD_RENDER_ORDER = -1

/** Birds and clouds with the clouds' shadows; how many are out follows the time of day, fading as it changes. */
export function SkyLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  const { dayChange, period, reducedMotion, motionEnabled, editing } = scene
  const cloudMesh = useRef<InstancedMesh>(null)
  const wings = useRef<InstancedMesh>(null)
  const bodies = useRef<InstancedMesh>(null)
  const beaks = useRef<InstancedMesh>(null)
  const shadows = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const elapsed = useRef(0)
  const shadowTexture = useMemo(() => createShadowTexture(), [])
  const cloudMaterial = useRef<MeshStandardMaterial>(null)
  const shadowMaterial = useRef<MeshBasicMaterial>(null)
  const lighting = useMemo(() => createDayLighting(), [])
  const sunPosition = useMemo<SunPosition>(() => [0, 1, 0], [])
  const birds = useMemo(() => createBirdSpecs(objects.filter(({ type }) => type === 'bird')), [objects])
  const clouds = useMemo(() => createCloudSpecs(objects.filter(({ type }) => type === 'cloud')), [objects])
  const wingInstances = useMemo(() => birdInstances(birds.length, BIRD_WING_PARTS), [birds.length])
  const bodyInstances = useMemo(() => birdInstances(birds.length, BIRD_BODY_PARTS), [birds.length])
  const beakInstances = useMemo(() => birdInstances(birds.length, BIRD_BEAK_PARTS), [birds.length])
  // How far each bird and cloud is out, 0 to 1; they fade in from nothing as the town opens.
  const birdPresence = useMemo(() => new Float32Array(birds.length), [birds.length])
  const cloudPresence = useMemo(() => new Float32Array(clouds.length), [clouds.length])
  const population = editing
    ? { birds: birds.length, clouds: clouds.length }
    : getActiveAtmosphereCounts(period, birds.length, clouds.length)
  useEffect(() => () => shadowTexture.dispose(), [shadowTexture])
  useLayoutEffect(() => {
    cloudMesh.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    wings.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    bodies.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    beaks.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    shadows.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    ;[cloudMesh, wings, bodies, beaks, shadows].forEach((mesh) => createInstanceOpacities(mesh.current))
    colorBirdParts(wings.current, birds, wingInstances)
    colorBirdParts(bodies.current, birds, bodyInstances)
    colorBirdParts(beaks.current, birds, beakInstances)
    colorClouds(cloudMesh.current, clouds)
  }, [beakInstances, birds, bodyInstances, clouds, wingInstances])

  useFrame((_, delta) => {
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    writeCloudShadowSun(lighting.sunDirection, sunPosition)
    cloudMaterial.current?.color.copy(lighting.cloud)
    if (shadowMaterial.current) shadowMaterial.current.opacity = getCloudShadowOpacity(sunPosition, lighting.sunlight)
    elapsed.current = editing ? 0 : advanceAtmosphereTime(elapsed.current, delta, reducedMotion, motionEnabled)
    // The editor shows every bird and cloud at once; the town fades them with the sky's own change.
    const fadeSeconds = editing ? 0 : getDayChangeDuration(reducedMotion)
    const shownBirds = stepAtmospherePresence(birdPresence, population.birds, delta, fadeSeconds)
    const shownClouds = stepAtmospherePresence(cloudPresence, population.clouds, delta, fadeSeconds)
    const wingCount = shownBirds * BIRD_WING_PARTS.length
    const bodyCount = shownBirds * BIRD_BODY_PARTS.length
    const beakCount = shownBirds * BIRD_BEAK_PARTS.length
    fadeClouds(cloudMesh.current, cloudPresence, shownClouds * PUFFS_PER_CLOUD, PUFFS_PER_CLOUD)
    fadeClouds(shadows.current, cloudPresence, shownClouds, 1)
    fadeBirds(wings.current, wingInstances, birdPresence, wingCount)
    fadeBirds(bodies.current, bodyInstances, birdPresence, bodyCount)
    fadeBirds(beaks.current, beakInstances, birdPresence, beakCount)
    updateClouds(cloudMesh.current, dummy, clouds, elapsed.current, shownClouds * PUFFS_PER_CLOUD)
    updateBirds(wings.current, dummy, birds, wingInstances, wingCount, elapsed.current, reducedMotion)
    updateBirds(bodies.current, dummy, birds, bodyInstances, bodyCount, elapsed.current, reducedMotion)
    updateBirds(beaks.current, dummy, birds, beakInstances, beakCount, elapsed.current, reducedMotion)
    updateCloudShadows(shadows.current, dummy, clouds, elapsed.current, sunPosition, shownClouds)
  })

  return (
    <>
      <instancedMesh
        key={`clouds-${clouds.length}`}
        ref={cloudMesh}
        args={[undefined, undefined, Math.max(1, clouds.length * PUFFS_PER_CLOUD)]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 14, 9]} />
        <meshStandardMaterial
          ref={cloudMaterial}
          roughness={1}
          transparent
          opacity={0.74}
          depthWrite={false}
          side={DoubleSide}
          onBeforeCompile={addInstanceOpacity}
        />
      </instancedMesh>
      <instancedMesh
        key={`wings-${birds.length}`}
        ref={wings}
        args={[undefined, undefined, Math.max(1, wingInstances.length)]}
        frustumCulled={false}
        renderOrder={BIRD_RENDER_ORDER}
      >
        <sphereGeometry args={[1, 12, 7]} />
        <meshBasicMaterial toneMapped={false} transparent onBeforeCompile={addInstanceOpacity} />
      </instancedMesh>
      <instancedMesh
        key={`bodies-${birds.length}`}
        ref={bodies}
        args={[undefined, undefined, Math.max(1, bodyInstances.length)]}
        frustumCulled={false}
        renderOrder={BIRD_RENDER_ORDER}
      >
        <sphereGeometry args={[1, 16, 10]} />
        <meshBasicMaterial toneMapped={false} transparent onBeforeCompile={addInstanceOpacity} />
      </instancedMesh>
      <instancedMesh
        key={`beaks-${birds.length}`}
        ref={beaks}
        args={[undefined, undefined, Math.max(1, beakInstances.length)]}
        frustumCulled={false}
        renderOrder={BIRD_RENDER_ORDER}
      >
        <coneGeometry args={[1, 1, 10]} />
        <meshBasicMaterial toneMapped={false} transparent onBeforeCompile={addInstanceOpacity} />
      </instancedMesh>
      <instancedMesh
        key={`shadows-${clouds.length}`}
        ref={shadows}
        args={[undefined, undefined, Math.max(1, clouds.length)]}
        frustumCulled={false}
        renderOrder={1}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={shadowMaterial}
          map={shadowTexture}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
          onBeforeCompile={addInstanceOpacity}
        />
      </instancedMesh>
    </>
  )
}
