import { useFrame } from '@react-three/fiber'
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  DynamicDrawUsage,
  Object3D,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { advanceAtmosphereTime } from '../../environment/atmosphereMotion'
import {
  addWaterShimmer,
  FOUNTAIN_DROPS,
  FOUNTAIN_ICICLES,
  FOUNTAIN_JET_SPARKLES,
  FOUNTAIN_RIPPLES,
  FOUNTAIN_SURFACE_SPARKLES,
  getFountainFlow,
  RIPPLE_OPACITY,
  updateDrops,
  updateIce,
  updateRipples,
  updateSparkles,
  type WaterShimmer,
} from './fountainMotion'
import { FOUNTAIN_RADIUS, FOUNTAIN_WATER_LEVEL } from './fountainLayout'
import { getSnowCover, seasonClock, type SeasonChange } from '../../environment/seasonTransition'
import type { MutableRefObject } from 'react'
import type { TownObject } from '../../../data/models'
import type { TownLayerProps } from '../townObjectKind'

export function Fountain({
  reducedMotion,
  motionEnabled,
  color = '#b3aa92',
  seasonChange,
}: {
  reducedMotion: boolean
  motionEnabled: boolean
  /** Basin stone. */
  color?: string
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const drops = useRef<InstancedMesh>(null)
  const ripples = useRef<InstancedMesh>(null)
  const rippleMaterial = useRef<MeshBasicMaterial>(null)
  const sparkles = useRef<InstancedMesh>(null)
  const ice = useRef<Mesh>(null)
  const iceMaterial = useRef<MeshStandardMaterial>(null)
  const icicles = useRef<InstancedMesh>(null)
  const elapsed = useRef(0)
  const shimmer = useRef<WaterShimmer>({ waterTime: { value: 0 }, waterFlow: { value: 1 } })
  const shimmerWater = useCallback(
    (shader: WebGLProgramParametersWithUniforms) => addWaterShimmer(shader, shimmer.current),
    [],
  )
  const dummy = useMemo(() => new Object3D(), [])
  useLayoutEffect(() => {
    drops.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    ripples.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    sparkles.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    icicles.current?.instanceMatrix.setUsage(DynamicDrawUsage)
  }, [])
  useFrame((_, delta) => {
    elapsed.current = advanceAtmosphereTime(elapsed.current, delta, reducedMotion, motionEnabled)
    const flow = getFountainFlow(getSnowCover(seasonChange.current, seasonClock()))
    updateDrops(drops.current, dummy, elapsed.current, flow)
    updateRipples(ripples.current, rippleMaterial.current, dummy, elapsed.current, flow)
    updateSparkles(sparkles.current, dummy, elapsed.current, flow)
    updateIce(ice.current, iceMaterial.current, icicles.current, dummy, 1 - flow)
    shimmer.current.waterTime.value = elapsed.current
    shimmer.current.waterFlow.value = flow
  })
  return (
    <group>
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <cylinderGeometry args={[2.2, FOUNTAIN_RADIUS, 0.35, 24]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      <mesh position={[0, FOUNTAIN_WATER_LEVEL, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.06, 32]} />
        <meshStandardMaterial color="#79c8cb" roughness={0.22} metalness={0.08} onBeforeCompile={shimmerWater} />
      </mesh>
      <mesh ref={ice} position={[0, FOUNTAIN_WATER_LEVEL + 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[2.08, 32]} />
        <meshStandardMaterial
          ref={iceMaterial}
          color="#e2f1f5"
          roughness={0.28}
          metalness={0.04}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.6, 1.5, 16]} />
        <meshStandardMaterial color="#9aa59d" roughness={0.9} />
      </mesh>
      <instancedMesh ref={icicles} args={[undefined, undefined, FOUNTAIN_ICICLES]} frustumCulled={false}>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial color="#e8f6fa" roughness={0.2} transparent opacity={0.88} />
      </instancedMesh>
      <instancedMesh ref={drops} args={[undefined, undefined, FOUNTAIN_DROPS]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 6]} />
        <meshBasicMaterial color="#d9fbfa" transparent opacity={0.8} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={ripples} args={[undefined, undefined, FOUNTAIN_RIPPLES]} frustumCulled={false}>
        <ringGeometry args={[0.96, 1, 32]} />
        <meshBasicMaterial
          ref={rippleMaterial}
          color="#dbfbef"
          transparent
          opacity={RIPPLE_OPACITY}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </instancedMesh>
      <instancedMesh
        ref={sparkles}
        args={[undefined, undefined, FOUNTAIN_SURFACE_SPARKLES + FOUNTAIN_JET_SPARKLES]}
        frustumCulled={false}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

/** The town is built around one fountain; a second one in the data is not drawn. */
export function FountainLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  const [fountain] = objects
  if (!fountain) return null
  return (
    <group position={[fountain.position.x, fountain.position.y, fountain.position.z]}>
      <group scale={fountain.scale}>
        <Fountain
          reducedMotion={scene.reducedMotion}
          motionEnabled={scene.motionEnabled}
          color={fountain.color}
          seasonChange={scene.seasonChange}
        />
      </group>
    </group>
  )
}
