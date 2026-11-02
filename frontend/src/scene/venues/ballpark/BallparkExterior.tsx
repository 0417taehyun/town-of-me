import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { DoubleSide, type Group, type InstancedMesh, type MeshStandardMaterial, Object3D } from 'three'
import { languageCopy } from '../../../i18n/language'
import { getSeasonColors } from '../../environment/season'
import { getSnowCover, seasonClock } from '../../environment/seasonTransition'
import { useSeasonalColor } from '../../environment/useSeasonChange'
import { writeInstanceColors, writeInstanceMatrices } from '../../instancedMeshes'
import { GroundGlow } from '../../objects/GroundGlow'
import { GuestbookSign } from '../../objects/guestbook/GuestbookLayer'
import { RoofSnow } from '../../objects/houses/RoofSnow'
import { useVenueMaterials } from '../venueMaterials'
import type { VenueExteriorProps } from '../VenueExteriors'
import { glowPositions } from './ballparkParts'
import { BallparkStatues } from './BallparkStatues'
import {
  archSnowRise,
  CORNICE_SNOW,
  corniceSnowGeometry,
  createExteriorGeometries,
  EXTERIOR_BOWL,
  EXTERIOR_FORECOURT,
  EXTERIOR_GATE,
  EXTERIOR_SIGN,
  exteriorBlooms,
  HALL_FRONT,
  hallGlowSpots,
  towerGlowSpots,
} from './ballparkExteriorLayout'
import { createCanvasTexture, drawGlass, drawLeaves } from './ballparkTextures'
import { resolveBallparkPalette } from './ballparkThemes'
import { Halos } from './Halos'

const hedgeColors = getSeasonColors('hedge')

/**
 * The garden ballpark beyond the town's hedge (ballparkExteriorLayout.ts). The hall, the cornice, the trims, and the
 * towers' petals take the admin's building colors; the hedges, the topiaries' plinths, and the towers' stems follow the
 * town's season, and the flowers in the hedges close up under the snow. Snow settles on the gate's arch, the bowl's
 * top, and the hall's cornice as on the houses' roofs, while the forecourt carries on the road that meets the gate,
 * cleared like it. While the town's lamps are on, the doors, the windows, the conservatory, and the towers' lamps glow,
 * with painted halos rather than lights. Inside the hedge, beside the road to the gate, stands its podium garden.
 */
export function BallparkExterior({
  settings,
  seasonChange,
  lampsOn,
  language,
  approachColor,
}: VenueExteriorProps<'ballpark'>) {
  const palette = useMemo(() => resolveBallparkPalette(settings), [settings])
  const materials = useVenueMaterials(palette)
  const geometries = useMemo(() => ({ ...createExteriorGeometries(), corniceSnow: corniceSnowGeometry() }), [])
  const textures = useMemo(
    () => ({ leaves: createCanvasTexture(256, drawLeaves), glass: createCanvasTexture(256, drawGlass) }),
    [],
  )
  const blooms = useMemo(() => exteriorBlooms(), [])
  const glows = useMemo(() => ({ towers: glowPositions(towerGlowSpots()), hall: glowPositions(hallGlowSpots()) }), [])
  useEffect(
    () => () => {
      Object.values(geometries).forEach((geometry) => geometry.dispose())
      Object.values(textures).forEach((texture) => texture.dispose())
    },
    [geometries, textures],
  )

  const hedge = useRef<MeshStandardMaterial>(null)
  const greens = useRef<MeshStandardMaterial>(null)
  const bowlSnow = useRef<Group>(null)
  const archSnow = useRef<Group>(null)
  const bloomMesh = useRef<InstancedMesh>(null)
  const bloomMaterial = useRef<MeshStandardMaterial>(null)
  useSeasonalColor(hedge, seasonChange, hedgeColors, 'ground')
  useSeasonalColor(greens, seasonChange, hedgeColors, 'ground')
  useLayoutEffect(() => {
    writeInstanceMatrices(bloomMesh.current, new Object3D(), blooms.length, (bloom, index) => {
      const { x, y, z, size } = blooms[index]
      bloom.position.set(x, y, z)
      bloom.scale.setScalar(size)
    })
    writeInstanceColors(bloomMesh.current, blooms.length, (index) => blooms[index].color)
    bloomMesh.current?.computeBoundingSphere()
  }, [blooms])
  useFrame(() => {
    const cover = getSnowCover(seasonChange.current, seasonClock())
    if (bowlSnow.current) {
      bowlSnow.current.visible = cover > 0.001
      bowlSnow.current.scale.y = Math.max(0.001, cover)
    }
    if (archSnow.current) {
      archSnow.current.visible = cover > 0.001
      archSnow.current.scale.y = archSnowRise(cover)
    }
    if (bloomMesh.current && bloomMaterial.current) {
      bloomMesh.current.visible = cover < 0.999
      bloomMaterial.current.opacity = 1 - cover
    }
  })

  const { width, near, far, y } = EXTERIOR_FORECOURT
  const forecourtDepth = near - far
  const sign = languageCopy[language].venues.ballpark.signs[settings.theme]

  return (
    <group>
      <mesh geometry={geometries.hedge} castShadow receiveShadow>
        <meshStandardMaterial ref={hedge} map={textures.leaves} roughness={1} side={DoubleSide} />
      </mesh>
      <group ref={bowlSnow} position-y={EXTERIOR_BOWL.height} visible={false}>
        <mesh geometry={geometries.bowlSnow} position-y={-EXTERIOR_BOWL.height}>
          <meshStandardMaterial color="#f3f8f9" roughness={1} side={DoubleSide} />
        </mesh>
      </group>
      <group ref={archSnow} position-y={EXTERIOR_GATE.pillarHeight} visible={false}>
        <mesh geometry={geometries.archSnow} position-y={-EXTERIOR_GATE.pillarHeight}>
          <meshStandardMaterial color="#f3f8f9" roughness={1} />
        </mesh>
      </group>
      <group position={CORNICE_SNOW.at}>
        <RoofSnow seasonChange={seasonChange} height={CORNICE_SNOW.rest}>
          <mesh geometry={geometries.corniceSnow}>
            <meshStandardMaterial color="#f4fbff" roughness={1} />
          </mesh>
        </RoofSnow>
      </group>
      <mesh geometry={geometries.greens}>
        <meshStandardMaterial ref={greens} roughness={0.9} />
      </mesh>
      <mesh geometry={geometries.walls} material={materials.walls} receiveShadow />
      <mesh geometry={geometries.roof} material={materials.roof} receiveShadow />
      <mesh geometry={geometries.trim} material={materials.trim} />
      <mesh geometry={geometries.accent} material={materials.accent} />
      <mesh geometry={geometries.doors}>
        <meshStandardMaterial
          color="#6b4a36"
          emissive="#ffcf86"
          emissiveIntensity={lampsOn ? 1.8 : 0.25}
          roughness={0.8}
        />
      </mesh>
      <mesh geometry={geometries.glass} renderOrder={2}>
        <meshStandardMaterial
          map={textures.glass}
          emissive="#ffcf8a"
          emissiveIntensity={lampsOn ? 0.8 : 0.04}
          transparent
          depthWrite={false}
          side={DoubleSide}
          roughness={0.45}
        />
      </mesh>
      {/* By day a lamp's face is trim like the rest of the blossom's white. */}
      {lampsOn ? (
        <mesh geometry={geometries.lamps}>
          <meshStandardMaterial color="#fff6dc" emissive="#ffd894" emissiveIntensity={2.2} roughness={0.5} />
        </mesh>
      ) : (
        <mesh geometry={geometries.lamps} material={materials.trim} />
      )}
      <mesh geometry={geometries.orange}>
        <meshStandardMaterial color="#e6a05c" map={textures.leaves} roughness={1} />
      </mesh>
      <mesh geometry={geometries.cream}>
        <meshStandardMaterial color="#fff8ea" map={textures.leaves} roughness={1} />
      </mesh>
      <mesh geometry={geometries.ink}>
        <meshStandardMaterial color="#352b29" roughness={0.5} />
      </mesh>
      <instancedMesh ref={bloomMesh} args={[undefined, undefined, blooms.length]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial ref={bloomMaterial} roughness={0.8} transparent />
      </instancedMesh>
      <mesh position={[0, y, (near + far) / 2]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[width, forecourtDepth, 4, 4]} />
        <meshStandardMaterial color={approachColor} roughness={1} />
      </mesh>
      <GuestbookSign title={sign} height={EXTERIOR_SIGN.height} position={EXTERIOR_SIGN.at} />
      <BallparkStatues seasonChange={seasonChange} lampsOn={lampsOn} language={language} />
      {lampsOn && (
        <>
          <Halos positions={glows.towers} size={11} />
          <Halos positions={glows.hall} size={4} />
          <GroundGlow position={[0, y + 0.02, HALL_FRONT + 3]} size={[13, 6]} color="#ffc46e" opacity={0.35} />
        </>
      )}
    </group>
  )
}
