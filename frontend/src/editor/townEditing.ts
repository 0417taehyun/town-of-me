import { CAMERA_DEFAULTS, CAMERA_EYE_TARGET_HEIGHT } from '../camera/cameraConfig'
import { effectiveBallparkRules, nextRankingMonth, plannedBallparkRules } from '../data/ballparkRules'
import { linkedInProfileUrlError } from '../data/linkedInProfile'
import {
  PET_ROUTE_POINTS,
  TOWN_GROUND_LIMIT,
  type BallparkColorRole,
  type BallparkRules,
  type LocalizedText,
  type ResidentDialogue,
  type TownObject,
  type TownObjectType,
  type TownPoint,
  type TownResident,
  type TownSnapshot,
  type Vec3,
} from '../data/models'
import { DEFAULT_PLAYER_PROFILE, randomizePlayerAppearance, type PlayerProfile } from '../data/playerProfile'
import { normalizeContactEmail } from '../data/townApi'
import { getDefaultPetRoute } from '../scene/animals/corgiGait'
import { getBenchPose, getBenchSeats } from '../scene/motion/characterPose'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { getRoadWorldPoints } from '../scene/objects/roads/roadLayout'
import { openVenueSlots } from '../scene/venues/venuePlacements'
import { pushOutOfVenueApproach, type VenueSlot } from '../scene/venues/venueSlots'
import { clamp } from '../motionMath'

export const EMPTY_LOCALIZED_TEXT: LocalizedText = { ko: '', en: '' }

/** `pet` selects the pet's walk for editing; the town has one pet, so its id is always `pet`. */
export type SingleSelection = { kind: 'object' | 'resident' | 'pet'; id: string; pointIndex?: number }

/** Two or more objects are `objects`; one object is always `object`, so its single-object inspector shows. */
export type EditorSelection = SingleSelection | { kind: 'objects'; ids: readonly string[] } | null

export const PET_SELECTION = { kind: 'pet', id: 'pet' } as const

/** `top` looks down on the map for editing; `visitor` shows the town from a visitor's eye level and distance. */
export type EditorView = 'top' | 'visitor'

const viewPoses: Record<EditorView, { targetHeight: number; distance: number; height: number }> = {
  top: { targetHeight: 0, distance: 32, height: 42 },
  visitor: {
    targetHeight: CAMERA_EYE_TARGET_HEIGHT,
    distance: CAMERA_DEFAULTS.distance,
    height: CAMERA_DEFAULTS.height,
  },
}

/** Where the camera goes when the view changes: same spot on the map, same heading, the view's height and distance. */
export function getEditorCameraPose(view: EditorView, target: Vec3, camera: Vec3) {
  const pose = viewPoses[view]
  const heading = Math.atan2(camera.x - target.x, camera.z - target.z)
  return {
    target: { x: target.x, y: pose.targetHeight, z: target.z },
    position: {
      x: target.x + Math.sin(heading) * pose.distance,
      y: pose.height,
      z: target.z + Math.cos(heading) * pose.distance,
    },
  }
}

const SKY_HEIGHT = { minimum: 2, maximum: 40 }
const ROUTE_POINT_LIMIT = 32
const ROAD_POINT_LIMIT = 64

export function isSkyObject(type: TownObjectType) {
  return Boolean(TOWN_OBJECT_KINDS[type].sky)
}

export function rounded(value: number) {
  return Math.round(value * 10) / 10
}

export function clampToTown(type: TownObjectType, position: Vec3): Vec3 {
  const sky = TOWN_OBJECT_KINDS[type].sky
  const limit = sky?.horizontalLimit ?? TOWN_GROUND_LIMIT
  return {
    x: rounded(clamp(position.x, -limit, limit)),
    y: sky ? rounded(clamp(position.y, SKY_HEIGHT.minimum, SKY_HEIGHT.maximum)) : position.y,
    z: rounded(clamp(position.z, -limit, limit)),
  }
}

/** Where an object stands once placed or moved: inside the town and out of the shown venues' approaches. */
export function placeInTown(type: TownObjectType, position: Vec3, openSlots: readonly VenueSlot[]): Vec3 {
  return clearOfVenueApproaches(type, clampToTown(type, position), openSlots)
}

/**
 * Out of the approaches the shown venues (`openSlots`) keep for themselves, if the object stands on the ground. A road
 * is left where it is: it is painted, and its position is only the origin of its points.
 */
export function clearOfVenueApproaches(type: TownObjectType, position: Vec3, openSlots: readonly VenueSlot[]): Vec3 {
  if (type === 'road' || isSkyObject(type)) return position
  const [x, z] = pushOutOfVenueApproach(openSlots, [position.x, position.z])
  return { ...position, x, z }
}

/** The object moved out of the shown venues' approaches, or the very same object when it already stands clear. */
export function objectClearOfVenues(object: TownObject, openSlots: readonly VenueSlot[]): TownObject {
  const position = clearOfVenueApproaches(object.type, object.position, openSlots)
  return position.x === object.position.x && position.z === object.position.z ? object : { ...object, position }
}

export function clampPoint([x, z]: TownPoint): TownPoint {
  return [
    rounded(clamp(x, -TOWN_GROUND_LIMIT, TOWN_GROUND_LIMIT)),
    rounded(clamp(z, -TOWN_GROUND_LIMIT, TOWN_GROUND_LIMIT)),
  ]
}

/** Ids follow the backend rule: lowercase letters, digits, and hyphens. */
export function createEditorId(prefix: string, existing: ReadonlySet<string>, random: () => number = Math.random) {
  const base = prefix.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)
  const candidate = () => `${base}-${Math.floor(random() * 36 ** 6).toString(36)}`
  let id = candidate()
  while (existing.has(id)) id = candidate()
  return id
}

export function townIds(town: TownSnapshot) {
  return new Set([...town.objects.map(({ id }) => id), ...town.residents.map(({ id }) => id)])
}

export function replaceObject(
  town: TownSnapshot,
  id: string,
  change: (object: TownObject) => TownObject,
): TownSnapshot {
  return { ...town, objects: town.objects.map((object) => (object.id === id ? change(object) : object)) }
}

export function replaceResident(
  town: TownSnapshot,
  id: string,
  change: (resident: TownResident) => TownResident,
): TownSnapshot {
  return { ...town, residents: town.residents.map((resident) => (resident.id === id ? change(resident) : resident)) }
}

export type ObjectChanges = Partial<Omit<TownObject, 'id' | 'type'>>

/** Applies each listed object's changes inside the town; every other object stays identical, so only these re-render. */
export function updateObjects(
  town: TownSnapshot,
  ids: readonly string[],
  changes: (object: TownObject) => ObjectChanges,
): TownSnapshot {
  const listed = new Set(ids)
  const openSlots = openVenueSlots(town.venues)
  return {
    ...town,
    objects: town.objects.map((object) =>
      listed.has(object.id) ? changedObject(object, changes(object), openSlots) : object,
    ),
  }
}

export function changedObject(object: TownObject, changes: ObjectChanges, openSlots: readonly VenueSlot[]): TownObject {
  const next = { ...object, ...changes }
  return { ...next, position: placeInTown(object.type, next.position, openSlots) }
}

export function updateObject(town: TownSnapshot, id: string, changes: ObjectChanges) {
  return updateObjects(town, [id], () => changes)
}

export function addObject(
  town: TownSnapshot,
  type: TownObjectType,
  at: Vec3,
  newcomerName: string,
  random = Math.random,
) {
  const id = createEditorId(type, townIds(town), random)
  const kind = TOWN_OBJECT_KINDS[type]
  const height = kind.sky?.defaultHeight ?? 0
  const object: TownObject = {
    id,
    type,
    position: placeInTown(type, { x: at.x, y: height, z: at.z }, openVenueSlots(town.venues)),
    rotation: 0,
    scale: 1,
    ...kind.defaults?.(newcomerName),
  }
  return { town: { ...town, objects: [...town.objects, object] }, id }
}

export type RemovalBlock = 'singleton' | 'bench-in-use'

export function getRemovalBlock(town: TownSnapshot, id: string): RemovalBlock | null {
  const object = town.objects.find((candidate) => candidate.id === id)
  if (!object) return null
  if (TOWN_OBJECT_KINDS[object.type].singleton) return 'singleton'
  return town.residents.some(({ benchId }) => benchId === id) ? 'bench-in-use' : null
}

export function removeObject(town: TownSnapshot, id: string): TownSnapshot {
  if (getRemovalBlock(town, id)) return town
  return { ...town, objects: town.objects.filter((object) => object.id !== id) }
}

/** Road points are stored relative to the road position, so dragging the whole road keeps its shape. */
export function moveRoadPoint(town: TownSnapshot, id: string, index: number, world: TownPoint) {
  return replaceObject(town, id, (road) => {
    const [x, z] = clampPoint(world)
    const point = [rounded(x - road.position.x), rounded(z - road.position.z)] as const
    return {
      ...road,
      points: (road.points ?? []).map((current, pointIndex) => (pointIndex === index ? point : current)),
    }
  })
}

/** Continues the last segment's direction by six units. */
export function extendedPoints(points: TownPoint[], limit: number) {
  if (points.length >= limit) return points
  const last = points.at(-1) ?? ([0, 0] as const)
  const previous = points.at(-2) ?? ([last[0] - 1, last[1]] as const)
  const step = 6 / (Math.hypot(last[0] - previous[0], last[1] - previous[1]) || 1)
  return [...points, clampPoint([last[0] + (last[0] - previous[0]) * step, last[1] + (last[1] - previous[1]) * step])]
}

export function addRoadPoint(town: TownSnapshot, id: string) {
  return replaceObject(town, id, (road) => ({ ...road, points: extendedPoints(road.points ?? [], ROAD_POINT_LIMIT) }))
}

export function removeRoadPoint(town: TownSnapshot, id: string, index: number) {
  return replaceObject(town, id, (road) => {
    const points = road.points ?? []
    if (points.length <= 2) return road
    return { ...road, points: points.filter((_, pointIndex) => pointIndex !== index) }
  })
}

export function updateResident(town: TownSnapshot, id: string, changes: Partial<Omit<TownResident, 'id'>>) {
  return replaceResident(town, id, (resident) => {
    const next = { ...resident, ...changes }
    return { ...next, profile: { ...next.profile, name: next.name } }
  })
}

/** `updateObject` as an edit for the editor's `edit` callback, applied to whatever town is current then. */
export function changeObject(id: string, changes: ObjectChanges) {
  return (town: TownSnapshot) => updateObject(town, id, changes)
}

/** The same changes for every listed object, as an edit for the editor's `edit` callback. */
export function changeObjects(ids: readonly string[], changes: ObjectChanges) {
  return (town: TownSnapshot) => updateObjects(town, ids, () => changes)
}

/** `updateResident` as an edit for the editor's `edit` callback, applied to whatever town is current then. */
export function changeResident(id: string, changes: Partial<Omit<TownResident, 'id'>>) {
  return (town: TownSnapshot) => updateResident(town, id, changes)
}

export function updateResidentProfile(town: TownSnapshot, id: string, profile: PlayerProfile) {
  return replaceResident(town, id, (resident) => ({ ...resident, profile: { ...profile, name: resident.name } }))
}

export function moveRoutePoint(town: TownSnapshot, id: string, index: number, world: TownPoint) {
  return replaceResident(town, id, (resident) => ({
    ...resident,
    route: resident.route.map((point, pointIndex) => (pointIndex === index ? clampPoint(world) : point)),
  }))
}

export function addRoutePoint(town: TownSnapshot, id: string) {
  return replaceResident(town, id, (resident) => ({
    ...resident,
    route: extendedPoints(resident.route, ROUTE_POINT_LIMIT),
  }))
}

/** Keeps at least two points and moves the bench stop down when an earlier point disappears. */
export function removeRoutePoint(town: TownSnapshot, id: string, index: number) {
  return replaceResident(town, id, (resident) => {
    if (resident.route.length <= 2 || index === resident.seatIndex) return resident
    return {
      ...resident,
      route: resident.route.filter((_, pointIndex) => pointIndex !== index),
      seatIndex: index < resident.seatIndex ? resident.seatIndex - 1 : resident.seatIndex,
    }
  })
}

/** Where a resident stands when their route reaches the bench stop. */
export function getBenchStop(town: TownSnapshot, resident: TownResident): TownPoint | null {
  const seat = getBenchSeats(town.objects).find(({ id }) => id === resident.benchId)
  if (!seat) return null
  const pose = getBenchPose(seat, false)
  return [pose.x, pose.z]
}

/** The points a resident walks between: at the bench stop they head for the spot in front of their bench instead. */
export function getResidentWalk(town: TownSnapshot, resident: TownResident): TownPoint[] {
  const benchStop = getBenchStop(town, resident)
  return resident.route.map((point, index) => (index === resident.seatIndex && benchStop ? benchStop : point))
}

/** A new resident walks a small loop near `at` and rests on the nearest bench. */
export function addResident(town: TownSnapshot, at: Vec3, name: string, random = Math.random) {
  const benches = town.objects.filter(({ type }) => type === 'bench')
  const distance = (bench: TownObject) => Math.hypot(bench.position.x - at.x, bench.position.z - at.z)
  const bench = benches.reduce<TownObject | null>(
    (nearest, candidate) => (!nearest || distance(candidate) < distance(nearest) ? candidate : nearest),
    null,
  )
  if (!bench) return { town, id: null }
  const id = createEditorId('resident', townIds(town), random)
  const resident: TownResident = {
    id,
    name,
    profile: randomizePlayerAppearance({ ...DEFAULT_PLAYER_PROFILE, name }, random),
    route: [[bench.position.x, bench.position.z], clampPoint([at.x + 4, at.z]), clampPoint([at.x, at.z + 4])],
    benchId: bench.id,
    seatIndex: 0,
    startSeated: false,
    role: EMPTY_LOCALIZED_TEXT,
    relationship: EMPTY_LOCALIZED_TEXT,
    reference: EMPTY_LOCALIZED_TEXT,
    dialogue: null,
  }
  return { town: { ...town, residents: [...town.residents, resident] }, id }
}

/** The town owner leaves with their resident, so the owner never names a resident that is gone. */
export function removeResident(town: TownSnapshot, id: string): TownSnapshot {
  return setResidentOwnership(
    { ...town, residents: town.residents.filter((resident) => resident.id !== id) },
    id,
    false,
  )
}

/** Makes the resident the town owner, moving it from whoever was; turning it off for the owner leaves none. */
export function setResidentOwnership(town: TownSnapshot, id: string, owner: boolean): TownSnapshot {
  if (owner) return { ...town, owner: { ...town.owner, residentId: id } }
  if (town.owner.residentId !== id) return town
  return { ...town, owner: { ...town.owner, residentId: null } }
}

/** Gives the pet its own walk, starting from the default loop around the fountain it walks now. */
export function startPetRoute(town: TownSnapshot): TownSnapshot {
  if (town.pet.route) return town
  const fountain = town.objects.find(({ type }) => type === 'fountain')
  return { ...town, pet: { ...town.pet, route: getDefaultPetRoute(fountain?.position).map(clampPoint) } }
}

/** Back to the default loop, which follows the fountain wherever it moves. */
export function resetPetRoute(town: TownSnapshot): TownSnapshot {
  return town.pet.route ? { ...town, pet: { ...town.pet, route: null } } : town
}

/** Leaves the town itself unchanged when the pet walks the default loop or `change` changes nothing. */
export function replacePetRoute(town: TownSnapshot, change: (route: TownPoint[]) => TownPoint[]): TownSnapshot {
  const route = town.pet.route && change(town.pet.route)
  if (!route || route === town.pet.route) return town
  return { ...town, pet: { ...town.pet, route } }
}

export function movePetRoutePoint(town: TownSnapshot, index: number, world: TownPoint) {
  return replacePetRoute(town, (route) =>
    route.map((point, pointIndex) => (pointIndex === index ? clampPoint(world) : point)),
  )
}

export function addPetRoutePoint(town: TownSnapshot) {
  return replacePetRoute(town, (route) => extendedPoints(route, PET_ROUTE_POINTS.maximum))
}

/** The walk stays a loop of at least three points. */
export function removePetRoutePoint(town: TownSnapshot, index: number) {
  return replacePetRoute(town, (route) =>
    route.length <= PET_ROUTE_POINTS.minimum ? route : route.filter((_, pointIndex) => pointIndex !== index),
  )
}

/**
 * Shows the ballpark to visitors or hides it; like the colors, this applies as soon as the town is saved. Showing it
 * moves the ground objects already standing in its garden's approach out, as placing them there would, in the same
 * edit, so one undo puts them back and they save together.
 */
export function withBallparkVisible(town: TownSnapshot, visible: boolean): TownSnapshot {
  const venues = { ...town.venues, ballpark: { ...town.venues.ballpark, visible } }
  const openSlots = openVenueSlots(venues)
  return { ...town, venues, objects: town.objects.map((object) => objectClearOfVenues(object, openSlots)) }
}

/** The admin's color for one of the ballpark's building roles, or the theme's color again when `color` is null. */
export function withBallparkColor(town: TownSnapshot, role: BallparkColorRole, color: string | null): TownSnapshot {
  const ballpark = town.venues.ballpark
  const colors = { ...ballpark.colors }
  delete colors[role]
  if (color !== null) colors[role] = color
  return { ...town, venues: { ...town.venues, ballpark: { ...ballpark, colors } } }
}

/**
 * Schedules `change` over the rules already planned (`plannedBallparkRules`) from the KST month after `month`, the
 * only way the admin changes the ballpark rules: the rules in effect stay the backend's. A schedule already due in
 * `month` becomes the rules in effect first, as the backend does on save, so this month's rules read right before
 * saving and the due schedule is never sent again. Rules equal to this month's leave nothing scheduled.
 */
export function withBallparkSchedule(town: TownSnapshot, change: Partial<BallparkRules>, month: string): TownSnapshot {
  const { visible, theme, colors } = town.venues.ballpark
  const inEffect = effectiveBallparkRules(town.venues.ballpark, month)
  const rules = { ...plannedBallparkRules(town.venues.ballpark, month), ...change }
  const unchanged = rules.pitchCount === inEffect.pitchCount && rules.difficulty === inEffect.difficulty
  const scheduled = unchanged ? {} : { scheduledRules: { fromMonth: nextRankingMonth(month), rules } }
  return { ...town, venues: { ...town.venues, ballpark: { visible, theme, colors, rules: inEffect, ...scheduled } } }
}

/** Cancels the scheduled change, so next month keeps this month's rules. */
export function withoutBallparkSchedule(town: TownSnapshot, month: string): TownSnapshot {
  return withBallparkSchedule(town, effectiveBallparkRules(town.venues.ballpark, month), month)
}

export type LayoutProblemKind =
  | 'town-names'
  | 'owner-introduction'
  | 'contact-email'
  | 'owner-name'
  | 'linkedin'
  | 'resident-name'
  | 'resident-linkedin'
  | 'resident-texts'
  | 'resident-dialogue'
  | 'owner-questions'
/** `id` is the object or resident to select to fix it; `null` for the town settings, or for owner questions with no resident to select. */
export type LayoutProblem = { id: string | null; problem: LayoutProblemKind }

const residentProblems: ReadonlySet<LayoutProblemKind> = new Set([
  'resident-name',
  'resident-linkedin',
  'resident-texts',
  'resident-dialogue',
  'owner-questions',
])

export function isResidentProblem(problem: LayoutProblemKind) {
  return residentProblems.has(problem)
}

/** What to select to fix `problem`; null for the owner's and pet's fields, which are in the town settings. */
export function problemSelection({ id, problem }: LayoutProblem): EditorSelection {
  if (id === null) return null
  return { kind: isResidentProblem(problem) ? 'resident' : 'object', id }
}

/** Missing in at least one language. */
export function isBlank(text: LocalizedText) {
  return !text.ko.trim() || !text.en.trim()
}
export function isHalfWritten(text: LocalizedText) {
  return !text.ko.trim() !== !text.en.trim()
}

export function dialogueLines(dialogue: ResidentDialogue) {
  return [dialogue.aboutOwner, ...dialogue.followUps.flatMap(({ question, answer }) => [question, answer])]
}

/** The backend needs the reference in both languages to draft what the resident says about the town owner. */
export function canDraftDialogue(resident: TownResident) {
  return Boolean(resident.name.trim()) && !isBlank(resident.reference)
}

export function getResidentProblems(resident: TownResident): LayoutProblemKind[] {
  const problems: Array<[boolean, LayoutProblemKind]> = [
    [!resident.name.trim(), 'resident-name'],
    [Boolean(linkedInProfileUrlError(resident.linkedInProfileUrl ?? '')), 'resident-linkedin'],
    [[resident.role, resident.relationship, resident.reference].some(isHalfWritten), 'resident-texts'],
    [Boolean(resident.dialogue && dialogueLines(resident.dialogue).some(isBlank)), 'resident-dialogue'],
  ]
  return problems.filter(([failed]) => failed).map(([, problem]) => problem)
}

export function getObjectProblems(object: TownObject): LayoutProblemKind[] {
  if (object.type !== 'house') return []
  const problems: Array<[boolean, LayoutProblemKind]> = [
    [!object.ownerName?.trim(), 'owner-name'],
    [Boolean(linkedInProfileUrlError(object.linkedInProfileUrl ?? '')), 'linkedin'],
  ]
  return problems.filter(([failed]) => failed).map(([, problem]) => problem)
}

/** A contact email being typed is checked once it is not blank; a blank one is saved as none. */
export function isInvalidContactEmail(email: string | null) {
  return Boolean(email?.trim()) && normalizeContactEmail(email) === null
}

export function getTownProblems(town: TownSnapshot): LayoutProblemKind[] {
  const problems: Array<[boolean, LayoutProblemKind]> = [
    [[town.owner.name, town.pet.name].some(isBlank), 'town-names'],
    [Boolean(town.owner.introduction && isHalfWritten(town.owner.introduction)), 'owner-introduction'],
    [isInvalidContactEmail(town.owner.contactEmail), 'contact-email'],
    [Boolean(linkedInProfileUrlError(town.owner.linkedInProfileUrl ?? '')), 'linkedin'],
  ]
  return problems.filter(([failed]) => failed).map(([, problem]) => problem)
}

/**
 * The owner's questions are edited with their resident, so "Show me" selects it. Without one nothing can edit them, and
 * the message says to mark a resident. A question or answer missing in either language would be rejected.
 */
export function getOwnerQuestionProblems(town: TownSnapshot): LayoutProblem[] {
  const blank = town.owner.questions.some(({ question, answer }) => isBlank(question) || isBlank(answer))
  return blank ? [{ id: town.owner.residentId, problem: 'owner-questions' }] : []
}

/** What the backend would reject, caught before saving so the admin can fix it in place. */
export function getLayoutProblems(town: TownSnapshot): LayoutProblem[] {
  return [
    ...getTownProblems(town).map((problem) => ({ id: null, problem })),
    ...getOwnerQuestionProblems(town),
    ...town.objects.flatMap((object) => getObjectProblems(object).map((problem) => ({ id: object.id, problem }))),
    ...town.residents.flatMap((resident) =>
      getResidentProblems(resident).map((problem): LayoutProblem => ({ id: resident.id, problem })),
    ),
  ]
}

/** Where an object's editor marker sits: roads are grabbed at their middle point, everything else at its position. */
export function getMarkerPosition(object: TownObject): Vec3 {
  if (object.type !== 'road') return object.position
  const points = getRoadWorldPoints(object)
  const [x, z] = points[Math.floor(points.length / 2)] ?? [object.position.x, object.position.z]
  return { x, y: 0, z }
}
