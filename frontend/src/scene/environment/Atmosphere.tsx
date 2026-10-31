import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Object3D,
  type Mesh,
  type MeshBasicMaterial,
} from 'three'
import type { MutableRefObject, Ref } from 'react'
import type { TownObject } from '../../data/models'
import {
  colorAmbientParticles,
  colorLeafDrop,
  startSeasonalParticles,
  updateAmbientParticles,
  updateLeafDrop,
  type SeasonalParticles,
} from './atmosphereMeshes'
import { createDayLighting, writeDayLighting, type DayChange } from './dayTransition'
import { Fireflies, Stars } from './NightLights'
import { seasonClock, type SeasonChange } from './seasonTransition'
import { advanceAtmosphereTime, LEAF_DROP_CAPACITY, SEASONAL_PARTICLE_COUNT } from './atmosphereMotion'

/** Petals, leaves, or snowflakes; the frame loop sets how many show. */
export function FallingParticles({ ref, capacity }: { ref: Ref<InstancedMesh>; capacity: number }) {
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, capacity]} count={0} frustumCulled={false} renderOrder={2}>
      <circleGeometry args={[1, 8]} />
      <meshBasicMaterial transparent opacity={0.86} side={DoubleSide} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  )
}

const skyVertexShader = /* glsl */ `
  varying vec3 skyDirection;
  void main() {
    skyDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Fog color from just below the horizon (-9 degrees) blending to the sky color at the zenith.
const skyFragmentShader = /* glsl */ `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  varying vec3 skyDirection;
  void main() {
    float elevation = asin(clamp(normalize(skyDirection).y, -1.0, 1.0));
    float height = clamp((elevation + 0.157) / 1.728, 0.0, 1.0);
    gl_FragColor = vec4(mix(horizonColor, zenithColor, height), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const sunDiscColor = new Color('#fff2c9')
const moonDiscColor = new Color('#e1e9fa')
const SUN_DISC_SIZE = 3
const MOON_DISC_SIZE = 2

/** The sky, sun, and moon, and what falls or glows in the air; birds and clouds are town objects. */
export function Atmosphere({
  dayChange,
  seasonChange,
  reducedMotion,
  motionEnabled,
  treeObjects,
  editing,
}: {
  dayChange: MutableRefObject<DayChange>
  seasonChange: MutableRefObject<SeasonChange>
  reducedMotion: boolean
  motionEnabled: boolean
  treeObjects: TownObject[]
  /** Holds the falling particles and fireflies still, so the editor shows the town as it stands. */
  editing: boolean
}) {
  const sky = useRef<Group>(null)
  const joiningParticles = useRef<InstancedMesh>(null)
  const leavingParticles = useRef<InstancedMesh>(null)
  const leafDrop = useRef<InstancedMesh>(null)
  const seasonalParticles = useRef<SeasonalParticles | null>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const elapsed = useRef(0)
  const sunDisc = useRef<Mesh>(null)
  const sunDiscMaterial = useRef<MeshBasicMaterial>(null)
  const lighting = useMemo(() => createDayLighting(), [])
  const skyUniforms = useMemo(() => ({ zenithColor: { value: new Color() }, horizonColor: { value: new Color() } }), [])
  useLayoutEffect(() => {
    ;[joiningParticles.current, leavingParticles.current, leafDrop.current].forEach((mesh) =>
      mesh?.instanceMatrix.setUsage(DynamicDrawUsage),
    )
  }, [])

  useFrame(({ camera, scene }, delta) => {
    sky.current?.position.copy(camera.position)
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    skyUniforms.zenithColor.value.copy(lighting.sky)
    skyUniforms.horizonColor.value.copy(lighting.fog)
    scene.fog?.color.copy(lighting.fog)
    if (scene.background instanceof Color) scene.background.copy(lighting.sky)
    sunDisc.current?.position.copy(lighting.sunDirection).multiplyScalar(80)
    sunDisc.current?.scale.setScalar(SUN_DISC_SIZE + (MOON_DISC_SIZE - SUN_DISC_SIZE) * lighting.night)
    sunDiscMaterial.current?.color.lerpColors(sunDiscColor, moonDiscColor, lighting.night)
    elapsed.current = editing ? 0 : advanceAtmosphereTime(elapsed.current, delta, reducedMotion, motionEnabled)
    const change = seasonChange.current
    let particles = seasonalParticles.current
    if (particles?.startedAt !== change.startedAt || particles.trees !== treeObjects) {
      const animated = motionEnabled && !reducedMotion && !editing
      particles = startSeasonalParticles(change, treeObjects, elapsed.current, animated)
      colorAmbientParticles(joiningParticles.current, particles.joining.season)
      colorAmbientParticles(leavingParticles.current, particles.leaving.season)
      colorLeafDrop(leafDrop.current, particles.drops)
      seasonalParticles.current = particles
    }
    updateAmbientParticles(joiningParticles.current, dummy, elapsed.current, particles.joining, true)
    updateAmbientParticles(leavingParticles.current, dummy, elapsed.current, particles.leaving, false)
    updateLeafDrop(leafDrop.current, dummy, elapsed.current - particles.changedAtElapsed, particles, change)
  })

  return (
    <>
      <group ref={sky}>
        <mesh renderOrder={-1}>
          <sphereGeometry args={[240, 24, 16]} />
          <shaderMaterial
            uniforms={skyUniforms}
            vertexShader={skyVertexShader}
            fragmentShader={skyFragmentShader}
            side={BackSide}
            depthWrite={false}
          />
        </mesh>
        <Stars dayChange={dayChange} />
      </group>
      <group>
        <mesh ref={sunDisc}>
          <sphereGeometry args={[1, 16, 12]} />
          {/* Back-sided like the dome, so the world curve leaves the sun where the light comes from. */}
          <meshBasicMaterial ref={sunDiscMaterial} fog={false} side={BackSide} />
        </mesh>
        <FallingParticles ref={joiningParticles} capacity={SEASONAL_PARTICLE_COUNT} />
        <FallingParticles ref={leavingParticles} capacity={SEASONAL_PARTICLE_COUNT} />
        <FallingParticles ref={leafDrop} capacity={LEAF_DROP_CAPACITY} />
        <Fireflies
          dayChange={dayChange}
          seasonChange={seasonChange}
          reducedMotion={reducedMotion}
          motionEnabled={motionEnabled}
          editing={editing}
        />
      </group>
    </>
  )
}
