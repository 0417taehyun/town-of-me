import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { DoubleSide, type InstancedMesh, type Mesh, type MeshStandardMaterial, Object3D } from 'three'
import type { TownObject } from '../../../data/models'
import { useWebFontGlyphs } from '../../../hooks/useWebFontGlyphs'
import { type AppLanguage, languageCopy } from '../../../i18n/language'
import { getSeasonColors } from '../../environment/season'
import { getSnowCover, isSeasonChangeSettled, seasonClock, type SeasonChange } from '../../environment/seasonTransition'
import { useSeasonalColor } from '../../environment/useSeasonChange'
import { setInstanceColors, writeInstanceColors, writeInstanceMatrices } from '../../instancedMeshes'
import { GroundGlow } from '../../objects/GroundGlow'
import { GuestbookSign } from '../../objects/guestbook/GuestbookLayer'
import { RoofSnow } from '../../objects/houses/RoofSnow'
import { Lamp } from '../../objects/lamps/LampsLayer'
import { usePodium } from '../../../hooks/usePodium'
import { placeSparkle } from '../../statues/paintedStatue'
import { PEDESTAL } from '../../statues/statueFinishes'
import { createStatueTextures, disposeStatueTextures, PLAQUE_FONT } from '../../statues/statueTextures'
import {
  BUNTING_COLORS,
  bedBloomColors,
  type BedFade,
  bedPlants,
  BLOOMS_PER_PLANT,
  createGardenGeometries,
  createPlaques,
  createPodiumStatues,
  createTwinkles,
  disposeMerged,
  disposePlaques,
  disposeTwinkles,
  fadeBedColors,
  paintPlaques,
  pedestalSnow,
  pennantPositions,
  type PodiumPlace,
  podiumPlaces,
  poseBeds,
  washInLampLight,
} from './ballparkStatueParts'
import { BALLPARK_GARDEN, STATUE_SCALE } from './ballparkStatueLayout'

const hedgeColors = getSeasonColors('hedge')
const garden = BALLPARK_GARDEN

export type GardenProps = {
  seasonChange: MutableRefObject<SeasonChange>
  lampsOn: boolean
  language: AppLanguage
  /** Holds the statues' twinkles. */
  still: boolean
}

/**
 * The podium garden beside the north road (ballparkStatueLayout.ts), drawn in the ballpark's slot frame while the
 * ballpark is shown: this month's top three as painted statues, read 2-1-3 on the stage, before an arc of hedge in
 * the town's season with bunting and flower beds, two of the town's lamps, which light at night, and a sign. A place
 * no one holds yet, or every place while the month's statues cannot be read, keeps a baseball on a cushion and says it
 * waits for a challenger. Snow settles on the pedestals and the beds in winter as on the town's roofs.
 */
export function BallparkStatues({ seasonChange, lampsOn, language, still }: GardenProps) {
  const copy = languageCopy[language].venues.ballpark.statues
  const podium = usePodium()
  // Read again every few minutes as a new but often equal answer; the statues are built again only when it differs.
  const placesKey = JSON.stringify(podiumPlaces(podium?.rows ?? [], language))
  const places = useMemo(() => JSON.parse(placesKey) as PodiumPlace[], [placesKey])
  const geometries = useMemo(() => createGardenGeometries(garden), [])
  useEffect(() => () => Object.values(geometries).forEach((geometry) => geometry.dispose()), [geometries])
  const hedge = useRef<MeshStandardMaterial>(null)
  useSeasonalColor(hedge, seasonChange, hedgeColors, 'ground')
  const [lamps] = useState(() =>
    garden.lamps.map(([x, z], index): TownObject => ({
      id: `podium-lamp-${index}`,
      type: 'lamp',
      position: { x, y: 0, z },
      rotation: 0,
      scale: 1,
    })),
  )
  const { stage, sign, turn, at } = garden

  return (
    <group position={[at[0], 0, at[1]]} rotation-y={turn}>
      <mesh geometry={geometries.stage} receiveShadow>
        <meshStandardMaterial color="#e3d5b5" roughness={0.92} />
      </mesh>
      <mesh geometry={geometries.hedge} castShadow receiveShadow>
        <meshStandardMaterial ref={hedge} roughness={1} />
      </mesh>
      <mesh geometry={geometries.wood} castShadow>
        <meshStandardMaterial color="#8a6446" roughness={0.9} />
      </mesh>
      <mesh geometry={geometries.knobs}>
        <meshStandardMaterial color="#d8b879" roughness={0.4} />
      </mesh>
      <Pennants geometry={geometries.pennant} />
      <FlowerBeds plant={geometries.bedPlant} seasonChange={seasonChange} />
      <PodiumStatues places={places} seasonChange={seasonChange} lampsOn={lampsOn} still={still} />
      {lamps.map((lamp) => (
        <Lamp key={lamp.id} object={lamp} lampsOn={lampsOn} />
      ))}
      <group position={[sign.x, 0, sign.z]} rotation-y={sign.turn}>
        <GuestbookSign title={copy.sign} height={0.34} position={[0, sign.height, 0]} />
      </group>
      {lampsOn && (
        <GroundGlow
          position={[0, stage.height + 0.01, stage.z]}
          size={[stage.radiusX * 2.4, stage.radiusZ * 2.8]}
          color="#ffc46e"
          opacity={0.4}
        />
      )}
    </group>
  )
}

export function Pennants({ geometry }: { geometry: Mesh['geometry'] }) {
  const mesh = useRef<InstancedMesh>(null)
  const positions = useMemo(() => pennantPositions(garden), [])
  useLayoutEffect(() => {
    writeInstanceMatrices(mesh.current, new Object3D(), positions.length, (pennant, index) =>
      pennant.position.copy(positions[index]),
    )
    writeInstanceColors(mesh.current, positions.length, (index) => BUNTING_COLORS[(index + 1) % BUNTING_COLORS.length])
    mesh.current?.computeBoundingSphere()
  }, [positions])
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, positions.length]}>
      <meshStandardMaterial side={DoubleSide} roughness={0.8} />
    </instancedMesh>
  )
}

/** The beds' leaf mounds, blooms, and drifts as three instanced meshes of one round shape. */
export function FlowerBeds({
  plant,
  seasonChange,
}: {
  plant: Mesh['geometry']
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const leaves = useRef<InstancedMesh>(null)
  const blooms = useRef<InstancedMesh>(null)
  const snow = useRef<InstancedMesh>(null)
  const plants = useMemo(() => bedPlants(garden), [])
  const dummy = useMemo(() => new Object3D(), [])
  const fade = useRef<BedFade | null>(null)
  const posedAt = useRef(Number.NaN)
  useLayoutEffect(() => {
    setInstanceColors(blooms.current, bedBloomColors(plants, seasonChange.current.to))
    const meshes = { leaves: leaves.current, blooms: blooms.current, snow: snow.current }
    poseBeds(meshes, plants, getSnowCover(seasonChange.current, seasonClock()), dummy)
    ;[leaves.current, blooms.current, snow.current].forEach((mesh) => mesh?.computeBoundingSphere())
    posedAt.current = Number.NaN
  }, [dummy, plants, seasonChange])
  useFrame(() => {
    const change = seasonChange.current
    fadeBedColors(blooms.current, fade, plants, change)
    if (posedAt.current === change.startedAt) return
    const now = seasonClock()
    const meshes = { leaves: leaves.current, blooms: blooms.current, snow: snow.current }
    poseBeds(meshes, plants, getSnowCover(change, now), dummy)
    if (isSeasonChangeSettled(change, now)) posedAt.current = change.startedAt
  })
  return (
    <group>
      <instancedMesh ref={leaves} args={[plant, undefined, plants.length]} castShadow receiveShadow>
        <meshStandardMaterial color="#5f9a55" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={blooms} args={[plant, undefined, plants.length * BLOOMS_PER_PLANT]}>
        <meshStandardMaterial roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={snow} args={[plant, undefined, plants.length]} visible={false} receiveShadow>
        <meshStandardMaterial color="#f4fbff" roughness={1} />
      </instancedMesh>
    </group>
  )
}

/**
 * This month's top three on their pedestals at the town's scale, merged into one mesh per material across all three,
 * with their snow, their twinkles, and at night the lamps' light on them; an empty place keeps its waiting baseball.
 * The twinkles hold still while `still`, and nothing else moves: the town's statues never sway.
 */
export function PodiumStatues({
  places,
  seasonChange,
  lampsOn,
  still,
}: {
  places: readonly PodiumPlace[]
  seasonChange: MutableRefObject<SeasonChange>
  lampsOn: boolean
  still: boolean
}) {
  const [textures] = useState(createStatueTextures)
  useEffect(() => () => disposeStatueTextures(textures), [textures])
  const [plaques] = useState(createPlaques)
  useEffect(() => () => disposePlaques(plaques), [plaques])
  const webFontReady = useWebFontGlyphs(PLAQUE_FONT, places.map(({ text }) => text).join(''))
  useLayoutEffect(() => paintPlaques(plaques, places, webFontReady), [places, plaques, webFontReady])
  const merged = useMemo(() => createPodiumStatues(garden, places, textures, plaques), [places, plaques, textures])
  useEffect(() => () => disposeMerged(merged), [merged])
  useLayoutEffect(() => washInLampLight(merged, lampsOn), [lampsOn, merged])
  const twinkles = useMemo(() => createTwinkles(garden, places, textures), [places, textures])
  useEffect(() => () => disposeTwinkles(twinkles), [twinkles])
  const snow = useMemo(
    () => garden.spots.map((spot) => ({ spot, ...pedestalSnow(spot.rank, places[spot.rank - 1].look === null) })),
    [places],
  )
  useEffect(
    () => () => snow.forEach(({ onTop, onPlinth }) => [onTop, onPlinth].forEach((geometry) => geometry.dispose())),
    [snow],
  )
  useFrame(() => {
    const seconds = performance.now() / 1000
    twinkles.sprites.forEach((sprite) => placeSparkle(sprite, seconds, still ? 0 : 1))
  })
  return (
    <>
      <primitive object={merged} />
      <primitive object={twinkles.group} />
      {snow.map(({ spot, top, onTop, onPlinth }) => (
        <group
          key={spot.rank}
          position={[spot.x, garden.stage.height, spot.z]}
          rotation-y={spot.turn}
          scale={STATUE_SCALE}
        >
          <RoofSnow seasonChange={seasonChange} height={top}>
            <mesh geometry={onTop} receiveShadow>
              <meshStandardMaterial color="#f4fbff" roughness={1} />
            </mesh>
          </RoofSnow>
          <RoofSnow seasonChange={seasonChange} height={PEDESTAL.plinthHeight}>
            <mesh geometry={onPlinth}>
              <meshStandardMaterial color="#f4fbff" roughness={1} />
            </mesh>
          </RoofSnow>
          {lampsOn && (
            // Where a lamp's light lands on the pedestal's top, without a light.
            <mesh rotation-x={-Math.PI / 2} position-y={top + 0.003} renderOrder={-1}>
              <circleGeometry args={[PEDESTAL.radius - 0.04, 48]} />
              <meshBasicMaterial map={textures.pool} transparent opacity={0.9} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}
    </>
  )
}
