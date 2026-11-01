import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { type Group, type InstancedMesh, type Mesh, type MeshStandardMaterial, Object3D } from 'three'
import { getRoundedBox } from '../../scene/roundedBox'
import { getSeasonColors } from '../../scene/environment/season'
import { getSnowCover, seasonClock, type SeasonChange } from '../../scene/environment/seasonTransition'
import { useSeasonalColor } from '../../scene/environment/useSeasonChange'
import type { BallparkPalette } from '../../scene/venues/ballpark/ballparkThemes'
import type { VenueMaterials } from '../../scene/venues/venueMaterials'
import { writeInstanceMatrices } from '../../scene/instancedMeshes'
import { FENCE_HEIGHT, MOUND_DISTANCE } from '../game/field'
import {
  BASE_SPOTS,
  chalkLines,
  coverWithSnow,
  createFenceSweep,
  createHomePlateShape,
  createInfieldShape,
  FIELD_LAYERS,
  FOUL_POLE,
  foulPoleSpots,
  GROUND_RADIUS,
  HEDGE_PROFILE,
  HEDGE_SNOW_PROFILE,
  INFIELD,
  MOUND,
  WARNING_TRACK_PROFILE,
} from './fieldLayout'
import { createCanvasTexture, drawLawn, drawLeaves } from './fieldTextures'

const lawnColors = getSeasonColors('ground')
const hedgeColors = getSeasonColors('hedge')
/** Meters of lawn one texture covers: a light and a dark mowing stripe. */
const LAWN_TILE_METERS = 12
const FLAT = -Math.PI / 2

/**
 * The playing field: lawn and the 3 m hedge on the judge's fence line, which take the visitor's season like the town's
 * grass and hedges and gather snow in winter. The dirt, chalk, and bases keep the theme's colors so the field reads in
 * every season; the foul poles wear the ballpark's accent under a roof-colored cap, topiary round their feet
 * (GardenLandmarks).
 */
export function StadiumField({
  materials,
  seasonChange,
}: {
  materials: VenueMaterials<keyof BallparkPalette>
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const lawn = useRef<MeshStandardMaterial>(null)
  const hedge = useRef<MeshStandardMaterial>(null)
  const snow = useRef<Mesh>(null)
  const snowMaterial = useRef<MeshStandardMaterial>(null)
  const hedgeSnow = useRef<Group>(null)
  const chalk = useRef<InstancedMesh>(null)
  const lines = useMemo(() => chalkLines(), [])
  const shapes = useMemo(() => ({ infield: createInfieldShape(), plate: createHomePlateShape() }), [])
  const sweeps = useMemo(
    () => ({
      hedge: createFenceSweep(HEDGE_PROFILE, { caps: true }),
      hedgeSnow: createFenceSweep(HEDGE_SNOW_PROFILE),
      track: createFenceSweep(WARNING_TRACK_PROFILE),
    }),
    [],
  )
  const textures = useMemo(() => {
    const lawnTexture = createCanvasTexture(256, drawLawn)
    lawnTexture.repeat.set((2 * GROUND_RADIUS) / LAWN_TILE_METERS, (2 * GROUND_RADIUS) / LAWN_TILE_METERS)
    return { lawn: lawnTexture, leaves: createCanvasTexture(256, drawLeaves) }
  }, [])
  useEffect(
    () => () => {
      Object.values(sweeps).forEach((geometry) => geometry.dispose())
      Object.values(textures).forEach((texture) => texture.dispose())
    },
    [sweeps, textures],
  )
  useLayoutEffect(() => {
    writeInstanceMatrices(chalk.current, new Object3D(), lines.length, (dummy, index) => {
      const line = lines[index]
      dummy.position.set(line.x, FIELD_LAYERS.chalk, line.z)
      dummy.rotation.set(0, line.yaw, 0)
      dummy.scale.set(line.width, 1, line.length)
    })
  }, [lines])
  useSeasonalColor(lawn, seasonChange, lawnColors, 'ground')
  useSeasonalColor(hedge, seasonChange, hedgeColors, 'ground')
  useFrame(() =>
    coverWithSnow(
      getSnowCover(seasonChange.current, seasonClock()),
      snow.current,
      snowMaterial.current,
      hedgeSnow.current,
    ),
  )

  return (
    <group>
      <mesh rotation-x={FLAT} receiveShadow>
        <circleGeometry args={[GROUND_RADIUS, 96]} />
        <meshStandardMaterial ref={lawn} map={textures.lawn} roughness={1} />
      </mesh>
      <mesh ref={snow} rotation-x={FLAT} position-y={FIELD_LAYERS.snow} receiveShadow visible={false}>
        <circleGeometry args={[GROUND_RADIUS, 96]} />
        <meshStandardMaterial ref={snowMaterial} color="#f3f8f9" roughness={1} transparent depthWrite={false} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={FIELD_LAYERS.dirt} material={materials.dirt} receiveShadow>
        <shapeGeometry args={[shapes.infield, 48]} />
      </mesh>
      <mesh rotation-x={FLAT} position-y={FIELD_LAYERS.dirt} material={materials.dirt} receiveShadow>
        <circleGeometry args={[INFIELD.homeRadius, 40]} />
      </mesh>
      {BASE_SPOTS.map((base, index) => (
        <mesh
          key={`dirt-${index}`}
          rotation-x={FLAT}
          position={[base.x, FIELD_LAYERS.baseDirt, base.z]}
          material={materials.dirt}
          receiveShadow
        >
          <circleGeometry args={[INFIELD.baseRadius, 28]} />
        </mesh>
      ))}
      <mesh geometry={sweeps.track} material={materials.dirt} receiveShadow />
      <mesh position={[0, MOUND.height / 2, -MOUND_DISTANCE]} material={materials.dirt} castShadow receiveShadow>
        <cylinderGeometry args={[MOUND.topRadius, MOUND.baseRadius, MOUND.height, 40]} />
      </mesh>
      <mesh position={[0, MOUND.height + 0.02, -MOUND_DISTANCE]} material={materials.lines}>
        <boxGeometry args={[0.61, 0.05, 0.15]} />
      </mesh>
      {BASE_SPOTS.map((base, index) => (
        <mesh
          key={`base-${index}`}
          position={[base.x, 0.05, base.z]}
          rotation-y={Math.PI / 4}
          material={materials.lines}
          castShadow
        >
          <primitive object={getRoundedBox(0.38, 0.08, 0.38, 0.03)} attach="geometry" />
        </mesh>
      ))}
      <mesh rotation-x={FLAT} position-y={FIELD_LAYERS.chalk + 0.005} material={materials.lines} receiveShadow>
        <shapeGeometry args={[shapes.plate]} />
      </mesh>
      <instancedMesh ref={chalk} args={[undefined, materials.lines, lines.length]} receiveShadow>
        <boxGeometry args={[1, 0.01, 1]} />
      </instancedMesh>
      <mesh geometry={sweeps.hedge} castShadow receiveShadow>
        <meshStandardMaterial ref={hedge} map={textures.leaves} roughness={1} />
      </mesh>
      <group ref={hedgeSnow} position-y={FENCE_HEIGHT} visible={false}>
        <mesh geometry={sweeps.hedgeSnow} position-y={-FENCE_HEIGHT} receiveShadow>
          <meshStandardMaterial color="#f3f8f9" roughness={1} />
        </mesh>
      </group>
      {foulPoleSpots().map((spot, index) => (
        <group key={`pole-${index}`} position={[spot.x, 0, spot.z]}>
          <mesh position-y={FOUL_POLE.height / 2} material={materials.accent} castShadow>
            <cylinderGeometry args={[FOUL_POLE.radius, FOUL_POLE.radius * 1.3, FOUL_POLE.height, 10]} />
          </mesh>
          <mesh position-y={FOUL_POLE.height + FOUL_POLE.capRadius * 0.6} material={materials.roof}>
            <sphereGeometry args={[FOUL_POLE.capRadius, 16, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
