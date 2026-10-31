import { useLayoutEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import {
  DISTANT_HEDGE_COUNT,
  DISTANT_HILL_COUNT,
  DISTANT_TREE_COUNT,
  setDistantHill,
  setForestTree,
  setForestTrunk,
  setHedgeBush,
} from './distantWorldLayout'
import { writeInstanceMatrices } from '../instancedMeshes'
import { getSeasonColors } from './season'
import type { SeasonChange } from './seasonTransition'
import { useSeasonalColor } from './useSeasonChange'

const distantGroundColors = getSeasonColors('distantGround')
const hillColors = getSeasonColors('hills')
const distantCrownColors = getSeasonColors('distantCrown')
const hedgeColors = getSeasonColors('hedge')

export function DistantWorld({ seasonChange }: { seasonChange: MutableRefObject<SeasonChange> }) {
  const crowns = useRef<InstancedMesh>(null)
  const trunks = useRef<InstancedMesh>(null)
  const hills = useRef<InstancedMesh>(null)
  const hedge = useRef<InstancedMesh>(null)
  const groundMaterial = useRef<MeshStandardMaterial>(null)
  const hillMaterial = useRef<MeshStandardMaterial>(null)
  const crownMaterial = useRef<MeshStandardMaterial>(null)
  const hedgeMaterial = useRef<MeshStandardMaterial>(null)
  useSeasonalColor(groundMaterial, seasonChange, distantGroundColors, 'ground')
  useSeasonalColor(hillMaterial, seasonChange, hillColors, 'ground')
  useSeasonalColor(crownMaterial, seasonChange, distantCrownColors, 'foliage')
  useSeasonalColor(hedgeMaterial, seasonChange, hedgeColors, 'ground')

  useLayoutEffect(() => {
    const dummy = new Object3D()
    writeInstanceMatrices(crowns.current, dummy, DISTANT_TREE_COUNT, setForestTree)
    writeInstanceMatrices(trunks.current, dummy, DISTANT_TREE_COUNT, setForestTrunk)
    writeInstanceMatrices(hills.current, dummy, DISTANT_HILL_COUNT, setDistantHill)
    writeInstanceMatrices(hedge.current, dummy, DISTANT_HEDGE_COUNT, setHedgeBush)
    ;[crowns.current, trunks.current, hills.current, hedge.current]
      .filter((mesh) => mesh !== null)
      .forEach((mesh) => mesh.computeBoundingSphere())
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.18, 0]} receiveShadow>
        <planeGeometry args={[360, 360, 36, 36]} />
        <meshStandardMaterial ref={groundMaterial} roughness={1} />
      </mesh>
      <instancedMesh ref={hills} args={[undefined, undefined, DISTANT_HILL_COUNT]}>
        <sphereGeometry args={[1, 20, 10]} />
        <meshStandardMaterial ref={hillMaterial} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, DISTANT_TREE_COUNT]}>
        <cylinderGeometry args={[1, 1.2, 1, 8]} />
        <meshStandardMaterial color="#726854" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, DISTANT_TREE_COUNT]}>
        <coneGeometry args={[1, 1, 10]} />
        <meshStandardMaterial ref={crownMaterial} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={hedge} args={[undefined, undefined, DISTANT_HEDGE_COUNT]} receiveShadow>
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial ref={hedgeMaterial} roughness={1} />
      </instancedMesh>
    </group>
  )
}
