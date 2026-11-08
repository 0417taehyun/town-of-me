import type { TownGuideStep, TownObject, TownSnapshot } from './models'

export type TownGuideEvent =
  | 'moved'
  | 'skidded'
  | 'glanced'
  | 'adjusted-view'
  | 'sat-on-bench'
  | 'tried-photo'
  | 'opened-character'
  | 'opened-environment'
  | 'greeted-pet'
  | 'heard-owner-reference'
  | 'visited-guestbook'

/** A visit saved before the pet's step was renamed still holds `'toto'`; it picks up at the same step. */
export function normalizeGuideStep(step: string | undefined): TownGuideStep | undefined {
  if (step === 'toto') return 'pet'
  return step as TownGuideStep | undefined
}

/** What a town lets a visitor practice: talk with a resident other than the owner, and skid turning at a run. */
export type TownGuideLessons = { hasResidents: boolean; canSkid: boolean }

export function nextTownGuideStep(
  current: TownGuideStep,
  event: TownGuideEvent,
  { hasResidents, canSkid }: TownGuideLessons,
): TownGuideStep {
  if (current === 'move' && event === 'moved') return canSkid ? 'run' : 'glance'
  // A town whose admin turned skids off after the visit reached this lesson has nothing to practice there.
  if (current === 'run' && (event === 'skidded' || !canSkid)) return 'glance'
  if (current === 'glance' && event === 'glanced') return 'view'
  if (current === 'view' && event === 'adjusted-view') return 'bench'
  if (current === 'bench' && event === 'sat-on-bench') return 'photo'
  if (current === 'photo' && event === 'tried-photo') return 'appearance'
  if (current === 'appearance' && event === 'opened-character') return 'environment'
  if (current === 'environment' && event === 'opened-environment') return 'pet'
  if (current === 'pet' && event === 'greeted-pet' && !hasResidents) return 'guestbook'
  if (current === 'pet' && event === 'greeted-pet') return 'resident'
  if (current === 'resident' && event === 'heard-owner-reference') return 'guestbook'
  if (current === 'guestbook' && event === 'visited-guestbook') return 'inactive'
  return current
}

export type GuidedHudControl = 'photo' | 'character' | 'environment'

/** The HUD button the current lesson asks the visitor to press, which the HUD marks so they can find it. */
export function guidedHudControl(step: TownGuideStep): GuidedHudControl | null {
  if (step === 'photo') return 'photo'
  if (step === 'appearance') return 'character'
  if (step === 'environment') return 'environment'
  return null
}

export function getGuideBench(town: TownSnapshot): TownObject | null {
  const assignedBenchIds = new Set(town.residents.map(({ benchId }) => benchId))
  const availableBenches = town.objects.filter((object) => object.type === 'bench' && !assignedBenchIds.has(object.id))
  const benches = availableBenches.length ? availableBenches : town.objects.filter(({ type }) => type === 'bench')
  const distance = (bench: TownObject) =>
    (bench.position.x - town.spawn.x) ** 2 + (bench.position.z - town.spawn.z) ** 2
  return benches.reduce<TownObject | null>(
    (nearest, bench) => (!nearest || distance(bench) < distance(nearest) ? bench : nearest),
    null,
  )
}
