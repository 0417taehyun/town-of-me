import type { InstancedMesh, Object3D } from 'three'
import type { TownObject } from '../../data/models'
import {
  getAmbientParticleCount,
  getSeasonalParticleColor,
  getSeasonalParticleVisibility,
  LEAF_DROP_CAPACITY,
  LEAVES_PER_TREE,
  SEASONAL_PARTICLE_COUNT,
  setLeafDropTransform,
  setSeasonalParticleTransform,
} from './atmosphereMotion'
import { writeInstanceColors, writeInstanceMatrices } from '../instancedMeshes'
import type { Season } from './season'
import { seasonClock, type SeasonChange, type SeasonWindow } from './seasonTransition'
import {
  getLeafDropSources,
  getSeasonalTreeSources,
  type LeafDropSource,
  type SeasonalTreeSource,
} from '../objects/trees/treeLayout'

/** Falling petals, leaves, or snow of one season; `gate` hands them over to or from the next season. */
export type AmbientParticles = {
  season: Season
  sources: SeasonalTreeSource[]
  count: number
  gate: SeasonWindow | null
}

/** What falls while the season changes, with gates and timings on the ambient clock. */
export type SeasonalParticles = {
  startedAt: number
  trees: TownObject[]
  changedAtElapsed: number
  joining: AmbientParticles
  leaving: AmbientParticles
  drops: LeafDropSource[]
}

export function updateAmbientParticles(
  mesh: InstancedMesh | null,
  dummy: Object3D,
  elapsed: number,
  particles: AmbientParticles,
  joining: boolean,
) {
  if (!mesh) return
  mesh.count = particles.count
  writeInstanceMatrices(mesh, dummy, particles.count, (transform, index) => {
    const fallingFor = setSeasonalParticleTransform(transform, index, elapsed, particles.season, particles.sources)
    transform.scale.multiplyScalar(
      getSeasonalParticleVisibility(index, elapsed, fallingFor, particles.gate, joining, particles.season),
    )
  })
}

export function getLeafDropCount(drops: LeafDropSource[]) {
  return Math.min(LEAF_DROP_CAPACITY, drops.length * LEAVES_PER_TREE)
}

export function updateLeafDrop(
  mesh: InstancedMesh | null,
  dummy: Object3D,
  sinceChange: number,
  particles: SeasonalParticles,
  change: SeasonChange,
) {
  if (!mesh) return
  const finished = !change.timeline.leafDrop || sinceChange > change.timeline.leavesRestUntil + 3
  mesh.count = finished ? 0 : getLeafDropCount(particles.drops)
  writeInstanceMatrices(mesh, dummy, mesh.count, (transform, index) =>
    setLeafDropTransform(transform, index, sinceChange, particles.drops, change.timeline),
  )
}

export function colorAmbientParticles(mesh: InstancedMesh | null, season: Season) {
  writeInstanceColors(mesh, SEASONAL_PARTICLE_COUNT, (index) => getSeasonalParticleColor(season, index))
}

export function colorLeafDrop(mesh: InstancedMesh | null, drops: LeafDropSource[]) {
  writeInstanceColors(
    mesh,
    getLeafDropCount(drops),
    (index) => drops[Math.floor(index / LEAVES_PER_TREE)].colors[index % 2],
  )
}

/**
 * Hands the falling particles from one season to the next on the ambient clock. Without ambient motion they
 * cannot fall, so the new season's simply show and nothing is shed.
 */
export function startSeasonalParticles(
  change: SeasonChange,
  trees: TownObject[],
  elapsed: number,
  animated: boolean,
): SeasonalParticles {
  const changing = animated && change.from !== change.to && Number.isFinite(change.startedAt)
  // The change may have started a moment before this frame noticed it.
  const changedAtElapsed = elapsed - Math.max(0, seasonClock() - change.startedAt)
  const gate = ({ start, end }: SeasonWindow) => ({ start: changedAtElapsed + start, end: changedAtElapsed + end })
  const ambient = (season: Season, window: SeasonWindow): AmbientParticles => {
    const sources = getSeasonalTreeSources(trees, season)
    return { season, sources, count: getAmbientParticleCount(season, sources), gate: changing ? gate(window) : null }
  }
  const leaving = ambient(change.from, change.timeline.particlesOut)
  return {
    startedAt: change.startedAt,
    trees,
    changedAtElapsed,
    joining: ambient(change.to, change.timeline.particlesIn),
    leaving: { ...leaving, count: changing ? leaving.count : 0 },
    drops: changing ? getLeafDropSources(trees, change.from, change.to) : [],
  }
}
