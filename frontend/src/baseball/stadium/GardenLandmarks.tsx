import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import {
  AdditiveBlending,
  type Group,
  type InstancedMesh,
  type MeshStandardMaterial,
  type MeshToonMaterial,
  Object3D,
} from 'three'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { getSeasonColors, type Season, seasonPalettes } from '../../scene/environment/season'
import { getSnowCover, seasonClock, type SeasonChange } from '../../scene/environment/seasonTransition'
import { useSeasonalColor } from '../../scene/environment/useSeasonChange'
import { getGlowTexture } from '../../scene/glowTexture'
import { writeInstanceMatrices } from '../../scene/instancedMeshes'
import { createGradientMap } from '../../scene/objects/foliageMaterial'
import type { BallparkPalette } from '../../scene/venues/ballpark/ballparkThemes'
import type { VenueMaterials } from '../../scene/venues/venueMaterials'
import { type DerbyHudState, distanceText } from '../ui/derbyCues'
import { coverWithSnow } from './fieldLayout'
import { createCanvasTexture, drawLeaves } from './fieldTextures'
import {
  createLandmarkGeometries,
  drawFenceLabels,
  FENCE_LABEL_ROW,
  FENCE_SIGN_SPRAYS,
  glowPositions,
  landmarkLights,
  OAK,
  OAK_SNOW,
  towerLampGlowSpots,
} from './landmarkLayout'
import { redrawScoreboard, scoreboardSummary } from './scoreboard'

const hedgeColors = getSeasonColors('hedge')
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
/** The oak's crown takes the town's second tree color for each season. */
const oakCrownColors = Object.fromEntries(
  SEASONS.map((season) => [season, seasonPalettes[season].treeCrowns[1]]),
) as Record<Season, string>

/**
 * The garden's landmarks (landmarkLayout.ts). Their buildings and the towers' blossoms take the ballpark's colors; the
 * oak's crown, the topiaries' hedge, and the towers' stems follow the season. The scoreboard shows the run as the HUD
 * does, a pitch at a time once its ball is down. While the town's lamps are on (`lampsOn`), the towers' lamps, the
 * string lights, and the treehouse's window glow, with painted halos rather than lights, and the scoreboard brightens.
 * Nothing here casts a shadow: it all stands far outside the sun's shadow frame round the plate and the mound.
 */
export function GardenLandmarks({
  materials,
  seasonChange,
  language,
  hud,
  pitchCount,
  lampsOn,
}: {
  materials: VenueMaterials<keyof BallparkPalette>
  seasonChange: MutableRefObject<SeasonChange>
  language: AppLanguage
  hud: DerbyHudState
  pitchCount: number
  lampsOn: boolean
}) {
  const geometries = useMemo(() => createLandmarkGeometries(), [])
  const bulbSpots = useMemo(() => landmarkLights().bulbs, [])
  const glows = useMemo(
    () => ({ bulbs: glowPositions(bulbSpots), towers: glowPositions(towerLampGlowSpots()) }),
    [bulbSpots],
  )
  const textures = useMemo(
    () => ({
      scoreboard: createCanvasTexture(1024, () => undefined, 512),
      labels: createCanvasTexture(256, drawFenceLabels, FENCE_LABEL_ROW * FENCE_SIGN_SPRAYS.length),
      leaves: createCanvasTexture(256, drawLeaves),
    }),
    [],
  )
  const gradientMap = useMemo(() => createGradientMap(), [])
  useEffect(
    () => () => {
      Object.values(geometries).forEach((geometry) => geometry.dispose())
      Object.values(textures).forEach((texture) => texture.dispose())
      gradientMap.dispose()
    },
    [geometries, gradientMap, textures],
  )
  const summary = scoreboardSummary(hud, pitchCount)
  const copy = languageCopy[language].baseball
  const { pitches, played, homeRuns, lastHomeRunDecimetres } = summary
  useEffect(
    () =>
      redrawScoreboard(
        textures.scoreboard,
        { pitches, played, homeRuns, lastHomeRunDecimetres },
        {
          title: copy.title,
          homeRuns: `${copy.hud.homeRuns} ${homeRuns}`,
          distance: lastHomeRunDecimetres === null ? '—' : distanceText(lastHomeRunDecimetres, language),
        },
      ),
    [copy, homeRuns, language, lastHomeRunDecimetres, pitches, played, textures],
  )

  const hedge = useRef<MeshStandardMaterial>(null)
  const greens = useRef<MeshStandardMaterial>(null)
  const crown = useRef<MeshToonMaterial>(null)
  const snowCap = useRef<Group>(null)
  const bulbs = useRef<InstancedMesh>(null)
  useSeasonalColor(hedge, seasonChange, hedgeColors, 'ground')
  useSeasonalColor(greens, seasonChange, hedgeColors, 'ground')
  useSeasonalColor(crown, seasonChange, oakCrownColors, 'foliage')
  useFrame(() => coverWithSnow(getSnowCover(seasonChange.current, seasonClock()), null, null, snowCap.current))
  useLayoutEffect(() => {
    writeInstanceMatrices(bulbs.current, new Object3D(), bulbSpots.length, (bulb, index) => {
      bulb.position.copy(bulbSpots[index])
      bulb.scale.setScalar(0.13)
    })
    bulbs.current?.computeBoundingSphere()
  }, [bulbSpots])
  const snowAt = OAK_SNOW.at.map((value) => value * OAK.scale)

  return (
    <group>
      <mesh geometry={geometries.bark} receiveShadow>
        <meshStandardMaterial color="#8a6446" roughness={1} />
      </mesh>
      <mesh geometry={geometries.crown}>
        <meshToonMaterial ref={crown} gradientMap={gradientMap} />
      </mesh>
      <group ref={snowCap} position={[OAK.x, snowAt[1] - 2, OAK.z + snowAt[2]]} visible={false}>
        <mesh position-y={2} scale={OAK_SNOW.size.map((value) => value * OAK.scale) as [number, number, number]}>
          <sphereGeometry args={[1, 20, 10]} />
          <meshStandardMaterial color="#f4fbff" roughness={1} />
        </mesh>
      </group>
      <mesh geometry={geometries.accent} material={materials.accent} receiveShadow />
      <mesh geometry={geometries.roof} material={materials.roof} receiveShadow />
      <mesh geometry={geometries.walls} material={materials.walls} receiveShadow />
      <mesh geometry={geometries.trim} material={materials.trim} receiveShadow />
      <mesh geometry={geometries.glass}>
        <meshStandardMaterial
          color="#3f4f5e"
          emissive="#ffc979"
          emissiveIntensity={lampsOn ? 1.6 : 0}
          roughness={0.4}
        />
      </mesh>
      <mesh geometry={geometries.screen}>
        <meshStandardMaterial
          map={textures.scoreboard}
          emissive="#ffffff"
          emissiveMap={textures.scoreboard}
          emissiveIntensity={lampsOn ? 0.9 : 0.35}
          roughness={0.9}
        />
      </mesh>
      {/* By day a lamp's face is trim like the rest of the blossom's white. */}
      {lampsOn ? (
        <mesh geometry={geometries.lamps}>
          <meshStandardMaterial color="#fff6dc" emissive="#ffd894" emissiveIntensity={2.2} roughness={0.5} />
        </mesh>
      ) : (
        <mesh geometry={geometries.lamps} material={materials.trim} receiveShadow />
      )}
      <mesh geometry={geometries.hedge} receiveShadow>
        <meshStandardMaterial ref={hedge} map={textures.leaves} roughness={1} />
      </mesh>
      <mesh geometry={geometries.greens}>
        <meshStandardMaterial ref={greens} roughness={0.9} />
      </mesh>
      <mesh geometry={geometries.orange}>
        <meshStandardMaterial color="#e6a05c" map={textures.leaves} roughness={1} />
      </mesh>
      <mesh geometry={geometries.cream}>
        <meshStandardMaterial color="#fff8ea" map={textures.leaves} roughness={1} />
      </mesh>
      <mesh geometry={geometries.ink}>
        <meshStandardMaterial color="#352b29" roughness={0.5} />
      </mesh>
      <mesh geometry={geometries.stone} receiveShadow>
        <meshStandardMaterial color="#ddd3bf" roughness={0.9} />
      </mesh>
      <mesh geometry={geometries.labels}>
        <meshStandardMaterial map={textures.labels} roughness={0.85} />
      </mesh>
      <lineSegments geometry={geometries.wire}>
        <lineBasicMaterial color="#4b4038" />
      </lineSegments>
      <instancedMesh ref={bulbs} args={[undefined, undefined, bulbSpots.length]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial
          color="#fff4d6"
          emissive="#ffcf7a"
          emissiveIntensity={lampsOn ? 2.6 : 0.2}
          roughness={0.5}
        />
      </instancedMesh>
      {lampsOn && <Halos positions={glows.bulbs} size={1.6} />}
      {lampsOn && <Halos positions={glows.towers} size={26} />}
    </group>
  )
}

/** Painted halos, one soft glow per point, `size` m across. */
export function Halos({ positions, size }: { positions: Float32Array; size: number }) {
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={getGlowTexture()}
        color="#ffd896"
        size={size}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}
