import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { InstancedMesh, Object3D } from 'three'
import type { TownObject } from '../../../data/models'
import type { Season } from '../../environment/season'
import {
  getGroundCoverAmount,
  getSnowCover,
  getStaggeredProgress,
  isSeasonChangeSettled,
  seasonClock,
  startColorFade,
  type SeasonChange,
} from '../../environment/seasonTransition'
import {
  fadeInstanceColors,
  markInstancesUpdated,
  setInstanceColors,
  writeInstanceColors,
  writeInstanceMatrices,
} from '../../instancedMeshes'
import { foliageDepthMaterial, foliageMaterial, updateFoliageSway } from '../foliageMaterial'
import type { TownLayerProps } from '../townObjectKind'
import {
  getCrownShake,
  getGroundCoverColor,
  getGroundCoverPieces,
  GROUND_COVER_SEASONS,
  setCrownMatrices,
  setGroundCoverPose,
  setSnowCapMatrices,
  setTrunkPose,
  treeColorsOf,
  type TreeFades,
} from './treeInstances'
import { getLeafDropSources, getSeasonalTreeSources, getTreeStagger } from './treeLayout'

export function InstancedTrees({
  objects,
  seasonChange,
  reducedMotion,
}: {
  objects: TownObject[]
  seasonChange: MutableRefObject<SeasonChange>
  reducedMotion: boolean
}) {
  const trunks = useRef<InstancedMesh>(null)
  const crowns = useRef<InstancedMesh>(null)
  const crownTops = useRef<InstancedMesh>(null)
  const snowCaps = useRef<InstancedMesh>(null)
  const snowyTrees = useMemo(() => getSeasonalTreeSources(objects, 'winter'), [objects])
  const dummy = useMemo(() => new Object3D(), [])
  const fades = useRef<TreeFades | null>(null)
  const settledAt = useRef(Number.NaN)

  useLayoutEffect(() => {
    writeInstanceMatrices(trunks.current, dummy, objects.length, (trunk, index) => setTrunkPose(trunk, objects[index]))
    const season = seasonChange.current.to
    setInstanceColors(crowns.current, treeColorsOf(objects, season, false))
    setInstanceColors(crownTops.current, treeColorsOf(objects, season, true))
    setCrownMatrices(objects, dummy, [crowns.current, crownTops.current], () => 0, 0)
    ;[trunks.current, crowns.current, crownTops.current].forEach(markInstancesUpdated)
    // The new layout starts from the current season's colors; the frame loop takes it from there.
    fades.current = null
    settledAt.current = Number.NaN
  }, [dummy, objects, seasonChange])

  useFrame(({ clock }) => {
    updateFoliageSway(clock.elapsedTime, reducedMotion)
    const change = seasonChange.current
    if (settledAt.current === change.startedAt) return
    const now = seasonClock()
    const elapsed = now - change.startedAt
    const { foliage, leafDrop } = change.timeline
    if (fades.current?.startedAt !== change.startedAt) {
      fades.current = {
        startedAt: change.startedAt,
        crowns: startColorFade(crowns.current?.instanceColor?.array, treeColorsOf(objects, change.to, false)),
        tops: startColorFade(crownTops.current?.instanceColor?.array, treeColorsOf(objects, change.to, true)),
        shedding: new Set(getLeafDropSources(objects, change.from, change.to).map(({ treeIndex }) => treeIndex)),
      }
    }
    const { shedding } = fades.current
    const foliageProgress = (index: number) => getStaggeredProgress(foliage, elapsed, getTreeStagger(index))
    fadeInstanceColors(crowns.current, fades.current.crowns, foliageProgress)
    fadeInstanceColors(crownTops.current, fades.current.tops, foliageProgress)
    const shakeOf = (index: number) => getCrownShake(leafDrop, shedding, index, elapsed)
    setCrownMatrices(objects, dummy, [crowns.current, crownTops.current], shakeOf, elapsed)
    setSnowCapMatrices(snowyTrees, dummy, snowCaps.current, getSnowCover(change, now))
    ;[crowns.current, crownTops.current, snowCaps.current].forEach(markInstancesUpdated)
    if (isSeasonChangeSettled(change, now)) settledAt.current = change.startedAt
  })

  return (
    <>
      <instancedMesh
        ref={trunks}
        args={[undefined, undefined, Math.max(1, objects.length)]}
        count={objects.length}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[0.28, 0.48, 2.3, 8]} />
        <meshStandardMaterial color="#76543b" roughness={1} />
      </instancedMesh>
      {/* Crowns cast shadows but do not receive them; self-shadowing striped the spheres. */}
      <instancedMesh
        ref={crowns}
        args={[undefined, foliageMaterial, Math.max(1, objects.length)]}
        count={objects.length}
        customDepthMaterial={foliageDepthMaterial}
        castShadow
      >
        <sphereGeometry args={[1.75, 16, 10]} />
      </instancedMesh>
      <instancedMesh
        ref={crownTops}
        args={[undefined, foliageMaterial, Math.max(1, objects.length)]}
        count={objects.length}
        customDepthMaterial={foliageDepthMaterial}
        castShadow
      >
        <sphereGeometry args={[1.45, 14, 8]} />
      </instancedMesh>
      <instancedMesh
        ref={snowCaps}
        args={[undefined, undefined, Math.max(1, snowyTrees.length)]}
        count={snowyTrees.length}
        castShadow
      >
        <sphereGeometry args={[1, 16, 8]} />
        <meshStandardMaterial color="#f4fbff" roughness={1} />
      </instancedMesh>
    </>
  )
}

export function SeasonalTreeGroundCover({
  objects,
  seasonChange,
}: {
  objects: TownObject[]
  seasonChange: MutableRefObject<SeasonChange>
}) {
  return (
    <>
      {GROUND_COVER_SEASONS.map((season) => (
        <GroundCoverLayer key={season} season={season} objects={objects} seasonChange={seasonChange} />
      ))}
    </>
  )
}

/** One season's piles under its trees; hidden outright while none of it lies on the ground, so it costs nothing. */
export function GroundCoverLayer({
  season,
  objects,
  seasonChange,
}: {
  season: Season
  objects: TownObject[]
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const mesh = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const settledAt = useRef(Number.NaN)
  const pieces = useMemo(
    () => getGroundCoverPieces(objects).filter((piece) => piece.season === season),
    [objects, season],
  )

  useLayoutEffect(() => {
    writeInstanceColors(mesh.current, pieces.length, (index) => getGroundCoverColor(pieces, index))
    markInstancesUpdated(mesh.current)
    settledAt.current = Number.NaN
  }, [pieces])

  useFrame(() => {
    const change = seasonChange.current
    const target = mesh.current
    if (!target || settledAt.current === change.startedAt) return
    const now = seasonClock()
    const amount = getGroundCoverAmount(season, change, now)
    target.visible = amount > 0
    writeInstanceMatrices(target, dummy, pieces.length, (piece, index) =>
      setGroundCoverPose(piece, pieces[index], amount),
    )
    if (isSeasonChangeSettled(change, now)) settledAt.current = change.startedAt
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, Math.max(1, pieces.length)]}
      count={pieces.length}
      receiveShadow
    >
      <sphereGeometry args={[1, 12, 6]} />
      <meshStandardMaterial roughness={1} />
    </instancedMesh>
  )
}

/** The trees, and the petals, leaves, or snow piled under them. */
export function TreesLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  return (
    <>
      <SeasonalTreeGroundCover objects={objects} seasonChange={scene.seasonChange} />
      <InstancedTrees objects={objects} seasonChange={scene.seasonChange} reducedMotion={scene.reducedMotion} />
    </>
  )
}
