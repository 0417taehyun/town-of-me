import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import {
  BoxGeometry,
  CatmullRomCurve3,
  DoubleSide,
  type Group,
  type InstancedMesh,
  type MeshStandardMaterial,
  Object3D,
  TubeGeometry,
  Vector3,
} from 'three'
import { createDayLighting, writeDayLighting, type DayChange } from '../../scene/environment/dayTransition'
import { getSeasonColors } from '../../scene/environment/season'
import { getSnowCover, seasonClock, type SeasonChange } from '../../scene/environment/seasonTransition'
import { useSeasonalColor } from '../../scene/environment/useSeasonChange'
import { writeInstanceMatrices } from '../../scene/instancedMeshes'
import { InstancedFlowers } from '../../scene/objects/flowers/FlowersLayer'
import { InstancedTrees } from '../../scene/objects/trees/TreesLayer'
import { getRoundedBox } from '../../scene/roundedBox'
import type { BallparkPalette } from '../../scene/venues/ballpark/ballparkThemes'
import type { VenueMaterials } from '../../scene/venues/venueMaterials'
import {
  CLOUD_COUNT,
  conservatoryRibPoints,
  conservatoryRibYaws,
  createConservatoryGlass,
  createOuterHedgeSweep,
  createStandsGeometry,
  FLOWER_BED,
  flowerBeds,
  gardenFlowers,
  gardenTrees,
  HILL_COUNT,
  OUTER_HEDGE_PROFILE,
  OUTER_HEDGE_SNOW_PROFILE,
  OUTER_HEDGE_TOP,
  PUFFS_PER_CLOUD,
  setCloudPuff,
  setFlowerBed,
  setHill,
  setHillSnow,
  setSeatBack,
  standSeats,
  steppingStones,
} from './bowlLayout'
import { coverWithSnow } from './fieldLayout'
import { createCanvasTexture, drawGlass, drawLeaves } from './fieldTextures'

const hedgeColors = getSeasonColors('hedge')
const hillColors = getSeasonColors('hills')
/** Radians a second the clouds drift round the park. */
const CLOUD_DRIFT = 0.004

/**
 * The garden bowl around the field (bowlLayout.ts). The stands and the conservatory's ribs take the ballpark's building
 * colors; the hedge, trees, hills, and flowers follow the visitor's season like the town's, with its snow.
 */
export function GardenBowl({
  materials,
  seasonChange,
  dayChange,
  reducedMotion,
}: {
  materials: VenueMaterials<keyof BallparkPalette>
  seasonChange: MutableRefObject<SeasonChange>
  dayChange: MutableRefObject<DayChange>
  reducedMotion: boolean
}) {
  const geometries = useMemo(
    () => ({
      stands: createStandsGeometry(),
      glass: createConservatoryGlass(),
      rib: new TubeGeometry(
        new CatmullRomCurve3(conservatoryRibPoints().map(([x, y, z]) => new Vector3(x, y, z))),
        40,
        0.16,
        6,
      ),
      hedge: createOuterHedgeSweep(OUTER_HEDGE_PROFILE),
      hedgeSnow: createOuterHedgeSweep(OUTER_HEDGE_SNOW_PROFILE),
      seat: new BoxGeometry(0.6, 0.6, 0.14),
    }),
    [],
  )
  const textures = useMemo(
    () => ({ glass: createCanvasTexture(256, drawGlass), leaves: createCanvasTexture(256, drawLeaves) }),
    [],
  )
  const layout = useMemo(() => {
    const seats = standSeats()
    return {
      seats: [seats.filter((seat) => seat.section % 2 === 0), seats.filter((seat) => seat.section % 2 === 1)],
      trees: gardenTrees([]),
      flowers: gardenFlowers(),
      beds: flowerBeds(),
      stones: steppingStones(),
    }
  }, [])
  useEffect(
    () => () => {
      Object.values(geometries).forEach((geometry) => geometry.dispose())
      Object.values(textures).forEach((texture) => texture.dispose())
    },
    [geometries, textures],
  )
  const seatMeshes = useRef<(InstancedMesh | null)[]>([])
  const ribs = useRef<InstancedMesh>(null)
  const beds = useRef<InstancedMesh>(null)
  const soil = useRef<InstancedMesh>(null)
  const stones = useRef<InstancedMesh>(null)
  const hills = useRef<InstancedMesh>(null)
  const hillSnow = useRef<InstancedMesh>(null)
  const hillSnowMaterial = useRef<MeshStandardMaterial>(null)
  const hedgeSnow = useRef<Group>(null)
  const hedge = useRef<MeshStandardMaterial>(null)
  const hillMaterial = useRef<MeshStandardMaterial>(null)
  const clouds = useRef<InstancedMesh>(null)
  const cloudMaterial = useRef<MeshStandardMaterial>(null)
  const lighting = useMemo(() => createDayLighting(), [])

  useLayoutEffect(() => {
    const dummy = new Object3D()
    layout.seats.forEach((seats, mesh) =>
      writeInstanceMatrices(seatMeshes.current[mesh], dummy, seats.length, (seat, index) =>
        setSeatBack(seat, seats[index]),
      ),
    )
    const yaws = conservatoryRibYaws()
    writeInstanceMatrices(ribs.current, dummy, yaws.length, (rib, index) => {
      rib.position.set(0, 0, 0)
      rib.rotation.set(0, yaws[index], 0)
      rib.scale.set(1, 1, 1)
    })
    writeInstanceMatrices(beds.current, dummy, layout.beds.length, (bed, index) =>
      setFlowerBed(bed, layout.beds[index]),
    )
    writeInstanceMatrices(soil.current, dummy, layout.beds.length, (bed, index) => {
      setFlowerBed(bed, layout.beds[index])
      bed.position.y = FLOWER_BED.height
    })
    writeInstanceMatrices(stones.current, dummy, layout.stones.length, (stone, index) => {
      const { x, z, yaw, width, depth } = layout.stones[index]
      stone.position.set(x, 0.03, z)
      stone.rotation.set(0, yaw, 0)
      stone.scale.set(width, 0.06, depth)
    })
    writeInstanceMatrices(hills.current, dummy, HILL_COUNT, setHill)
    writeInstanceMatrices(hillSnow.current, dummy, HILL_COUNT, setHillSnow)
    writeInstanceMatrices(clouds.current, dummy, CLOUD_COUNT * PUFFS_PER_CLOUD, setCloudPuff)
    ;[...seatMeshes.current, ribs.current, hills.current, hillSnow.current, clouds.current]
      .filter((mesh) => mesh !== null)
      .forEach((mesh) => mesh.computeBoundingSphere())
  }, [layout])
  useSeasonalColor(hedge, seasonChange, hedgeColors, 'ground')
  useSeasonalColor(hillMaterial, seasonChange, hillColors, 'ground')
  useFrame((_, delta) => {
    const cover = getSnowCover(seasonChange.current, seasonClock())
    coverWithSnow(cover, hillSnow.current, hillSnowMaterial.current, hedgeSnow.current)
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    cloudMaterial.current?.color.copy(lighting.cloud)
    if (clouds.current && !reducedMotion) clouds.current.rotation.y += delta * CLOUD_DRIFT
  })

  return (
    <group>
      <mesh geometry={geometries.stands} material={[materials.walls, materials.roof]} castShadow receiveShadow />
      {layout.seats.map((seats, index) => (
        <instancedMesh
          key={index}
          ref={(mesh) => {
            seatMeshes.current[index] = mesh
          }}
          args={[geometries.seat, index === 0 ? materials.roof : materials.accent, seats.length]}
          receiveShadow
        />
      ))}
      <mesh geometry={geometries.glass} renderOrder={2}>
        <meshStandardMaterial map={textures.glass} transparent depthWrite={false} side={DoubleSide} roughness={0.45} />
      </mesh>
      <instancedMesh ref={ribs} args={[geometries.rib, materials.trim, conservatoryRibYaws().length]} />
      <mesh geometry={geometries.hedge} receiveShadow>
        <meshStandardMaterial ref={hedge} map={textures.leaves} roughness={1} />
      </mesh>
      <group ref={hedgeSnow} position-y={OUTER_HEDGE_TOP} visible={false}>
        <mesh geometry={geometries.hedgeSnow} position-y={-OUTER_HEDGE_TOP}>
          <meshStandardMaterial color="#f3f8f9" roughness={1} />
        </mesh>
      </group>
      <InstancedTrees
        objects={layout.trees}
        seasonChange={seasonChange}
        reducedMotion={reducedMotion}
        castShadow={false}
      />
      <InstancedFlowers objects={layout.flowers} seasonChange={seasonChange} reducedMotion={reducedMotion} />
      <instancedMesh
        ref={beds}
        args={[
          getRoundedBox(FLOWER_BED.width, FLOWER_BED.height, FLOWER_BED.length, 0.08),
          materials.accent,
          layout.beds.length,
        ]}
        castShadow
        receiveShadow
      />
      <instancedMesh ref={soil} args={[undefined, undefined, layout.beds.length]} receiveShadow>
        <boxGeometry args={[FLOWER_BED.width - 0.2, 0.04, FLOWER_BED.length - 0.2]} />
        <meshStandardMaterial color="#7d5b43" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={stones} args={[undefined, undefined, layout.stones.length]} receiveShadow>
        <cylinderGeometry args={[1, 1, 1, 9]} />
        <meshStandardMaterial color="#ddd3bf" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={hills} args={[undefined, undefined, HILL_COUNT]}>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial ref={hillMaterial} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={hillSnow} args={[undefined, undefined, HILL_COUNT]} visible={false}>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial ref={hillSnowMaterial} color="#f3f8f9" roughness={1} transparent depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={clouds} args={[undefined, undefined, CLOUD_COUNT * PUFFS_PER_CLOUD]}>
        <sphereGeometry args={[1, 14, 9]} />
        <meshStandardMaterial
          ref={cloudMaterial}
          roughness={1}
          transparent
          opacity={0.8}
          depthWrite={false}
          fog={false}
        />
      </instancedMesh>
    </group>
  )
}
