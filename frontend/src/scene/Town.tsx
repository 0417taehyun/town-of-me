import { useFrame } from '@react-three/fiber'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Mesh, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three'
import type { TownObject, TownSnapshot } from '../data/models'
import { ContactShadows } from './ContactShadows'
import { DistantWorld } from './environment/DistantWorld'
import { getFountainPlaza } from './environment/groundSurface'
import { getSeasonColors } from './environment/season'
import { getSnowCover, seasonClock, type SeasonChange } from './environment/seasonTransition'
import { SnowFootprints } from './environment/SnowFootprints'
import { addSnowCover, drawGround, drawSnowDepth, type GroundLayout } from './environment/townGround'
import { useSeasonalColor } from './environment/useSeasonChange'
import { getContactShadowLayout, getTownLayers } from './objects/kinds'
import { getTownRoads } from './objects/roads/roadLayout'
import type { TownLayerProps } from './objects/townObjectKind'
import { groupTownObjects } from './townObjectGroups'

const groundColors = getSeasonColors('ground')

export function TownGround({
  seasonChange,
  roads,
  fountain,
}: {
  seasonChange: MutableRefObject<SeasonChange>
  roads: TownObject[]
  fountain: TownObject | undefined
}) {
  const grass = useRef<MeshStandardMaterial>(null)
  const snow = useRef<Mesh>(null)
  const snowCover = useRef({ value: 0 })
  const coverWithSnow = useCallback(
    (shader: WebGLProgramParametersWithUniforms) => addSnowCover(shader, snowCover.current),
    [],
  )
  useSeasonalColor(grass, seasonChange, groundColors, 'ground')
  useFrame(() => {
    snowCover.current.value = getSnowCover(seasonChange.current, seasonClock())
    if (snow.current) snow.current.visible = snowCover.current.value > 0.001
  })
  // A value key keeps dragging any other object from redrawing and re-uploading the 2k ground texture.
  const layoutKey = JSON.stringify({ roads: getTownRoads(roads), plaza: getFountainPlaza(fountain) })
  const texture = useMemo(() => drawGround(JSON.parse(layoutKey) as GroundLayout), [layoutKey])
  const snowDepth = useMemo(() => drawSnowDepth(JSON.parse(layoutKey) as GroundLayout), [layoutKey])
  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => snowDepth.dispose(), [snowDepth])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[106, 106, 48, 48]} />
        <meshStandardMaterial ref={grass} roughness={1} />
      </mesh>
      <mesh ref={snow} position={[0, 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow renderOrder={-1}>
        <planeGeometry args={[106, 106, 48, 48]} />
        <meshStandardMaterial
          color="#f3f8f9"
          roughness={1}
          alphaMap={snowDepth}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
          onBeforeCompile={coverWithSnow}
        />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[106, 106, 48, 48]} />
        <meshStandardMaterial map={texture} transparent depthWrite={false} roughness={1} />
      </mesh>
    </group>
  )
}

/** The ground, then every kind's layer from the registry, then the contact shadows under them. */
export const Town = memo(function Town({ town, scene }: { town: TownSnapshot; scene: TownLayerProps }) {
  const groups = useMemo(() => groupTownObjects(town.objects), [town.objects])
  const layers = useMemo(() => getTownLayers(town.objects), [town.objects])
  const shadowPatches = useMemo(() => getContactShadowLayout(town.objects), [town.objects])
  return (
    <>
      <TownGround seasonChange={scene.seasonChange} roads={groups.roads} fountain={groups.fountain} />
      <SnowFootprints playerPosition={scene.playerPosition} seasonChange={scene.seasonChange} />
      <DistantWorld seasonChange={scene.seasonChange} />
      {layers.map(({ Layer, objects }, index) => (
        <Layer key={index} objects={objects} scene={scene} />
      ))}
      <ContactShadows patches={shadowPatches} />
    </>
  )
})
