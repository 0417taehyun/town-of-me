import type { TownPoint, TownResident, TownSnapshot } from '../data/models'
import { getPetRoute } from '../scene/animals/corgiGait'
import { PET_BODY_RADIUS } from '../scene/motion/npcMotion'
import { getObjectCollision, PLAYER_RADIUS, segmentTouchesTown, type TownCollision } from '../scene/townCollision'
import { getResidentWalk, type EditorSelection } from './townEditing'

export type WalkLeg = readonly [TownPoint, TownPoint]

/** Walkers go on to the next or the previous point, so the last point leads back to the first. */
export function getWalkLegs(points: readonly TownPoint[]): WalkLeg[] {
  const legs = points.map((point, index) => [point, points[(index + 1) % points.length]] as const)
  // Two points make one leg, walked both ways.
  return points.length === 2 ? legs.slice(0, 1) : legs
}

/** The legs that a body of radius `clearance` cannot walk straight along without touching something solid. */
export function getBlockedLegs(points: readonly TownPoint[], solids: TownCollision, clearance: number) {
  return getWalkLegs(points).filter(([[startX, startZ], [endX, endZ]]) =>
    segmentTouchesTown({ x: startX, z: startZ }, { x: endX, z: endZ }, solids, clearance),
  )
}

/** A resident walks up to their own bench to sit on it, so that bench is not in the way. */
export function getResidentBlockedLegs(town: TownSnapshot, resident: TownResident) {
  const solids = getObjectCollision(town.objects.filter(({ id }) => id !== resident.benchId))
  return getBlockedLegs(getResidentWalk(town, resident), solids, PLAYER_RADIUS)
}

/** The pet's own walk, or the default loop around the fountain while it has none. */
export function getPetBlockedLegs(town: TownSnapshot) {
  const fountain = town.objects.find(({ type }) => type === 'fountain')
  return getBlockedLegs(getPetRoute(town.pet, fountain?.position), getObjectCollision(town.objects), PET_BODY_RADIUS)
}

/** The blocked legs of the selected resident's or the pet's walk; none for anything else. */
export function getSelectedBlockedLegs(town: TownSnapshot, selection: EditorSelection): WalkLeg[] {
  if (selection?.kind === 'pet') return getPetBlockedLegs(town)
  const resident = selection?.kind === 'resident' ? town.residents.find(({ id }) => id === selection.id) : undefined
  return resident ? getResidentBlockedLegs(town, resident) : []
}
