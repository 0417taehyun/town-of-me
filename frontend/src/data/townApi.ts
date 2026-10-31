import { GAIT_STYLES } from '../scene/motion/gait'
import { SKID_STYLES } from '../scene/motion/skidTurn'
import { normalizeLinkedInProfileUrl } from './linkedInProfile'
import { recordOrEmpty, requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'
import { isPlayerColor, normalizePlayerProfile, profileAppearance } from './playerProfile'
import {
  BALLPARK_COLOR_ROLES,
  BALLPARK_THEMES,
  BASEBALL_DIFFICULTIES,
  DEFAULT_TOWN_MOVEMENT,
  DEFAULT_TOWN_VENUES,
  PET_ROUTE_POINTS,
  PITCH_COUNT_RANGE,
  RANKING_MONTH_PATTERN,
  TOWN_GROUND_LIMIT,
  TOWN_OBJECT_TYPES,
  TOWN_OBJECT_VARIANTS,
  type BallparkColorRole,
  type BallparkRules,
  type BallparkSettings,
  type LocalizedText,
  type ResidentDialogue,
  type ScheduledBallparkRules,
  type TownObject,
  type TownObjectType,
  type TownPoint,
  type TownOwner,
  type TownPet,
  type TownResident,
  type TownMovement,
  type TownSnapshot,
  type TownVenues,
  type Vec3,
} from './models'

// The wire format of backend/src/town.ts. The backend validates every save; this guards the render boundary.

const objectTypes = new Set<string>(TOWN_OBJECT_TYPES)
const ballparkColorRoles = new Set<string>(BALLPARK_COLOR_ROLES)

export function trimmedText(value: unknown, label: string) {
  return requireText(value, label).trim()
}

export function optionalText(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return undefined
  return trimmedText(value, label)
}

export function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

export function optionalNumber(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined
  return finiteNumber(value, label)
}

export function parseVector(value: unknown, label: string): Vec3 {
  const input = requireRecord(value, label)
  return {
    x: finiteNumber(input.x, `${label}.x`),
    y: finiteNumber(input.y, `${label}.y`),
    z: finiteNumber(input.z, `${label}.z`),
  }
}

export function parsePoint(point: unknown, label: string): TownPoint {
  if (!Array.isArray(point) || point.length !== 2) throw new Error(`${label} must contain x and z`)
  return [finiteNumber(point[0], `${label}[0]`), finiteNumber(point[1], `${label}[1]`)] as const
}

export function parsePoints(value: unknown, label: string): TownPoint[] {
  const input = requireList(value, label)
  if (input.length < 2) throw new Error(`${label} needs at least two points`)
  return input.map((point, index) => parsePoint(point, `${label}[${index}]`))
}

export function parseBenchSeats(value: unknown, label: string) {
  const seats = optionalNumber(value, label)
  if (seats !== undefined && seats !== 1 && seats !== 2) throw new Error(`${label} must be 1 or 2`)
  return seats
}

/** The saved variant when this build can draw it; otherwise none, and the object's id picks one. */
export function knownVariant(type: TownObjectType, value: unknown) {
  return typeof value === 'string' && TOWN_OBJECT_VARIANTS[type]?.includes(value) ? value : undefined
}

/** `null` for a kind this build cannot draw, which the town then leaves out. */
export function parseObject(value: unknown, index: number): TownObject | null {
  const label = `objects[${index}]`
  const input = requireRecord(value, label)
  const type = trimmedText(input.type, `${label}.type`)
  if (!objectTypes.has(type)) return null
  const object: TownObject = {
    id: trimmedText(input.id, `${label}.id`),
    type: type as TownObjectType,
    variant: knownVariant(type as TownObjectType, input.variant),
    position: parseVector(input.position, `${label}.position`),
    rotation: optionalNumber(input.rotation, `${label}.rotation`) ?? 0,
    scale: optionalNumber(input.scale, `${label}.scale`) ?? 1,
    color: optionalText(input.color, `${label}.color`),
    seats: parseBenchSeats(input.seats, `${label}.seats`),
    points: input.points === undefined ? undefined : parsePoints(input.points, `${label}.points`),
    width: optionalNumber(input.width, `${label}.width`),
    ownerName: optionalText(input.ownerName, `${label}.ownerName`),
    description: optionalText(input.description, `${label}.description`),
    linkedInProfileUrl: normalizeLinkedInProfileUrl(input.linkedInProfileUrl) ?? undefined,
  }
  if (object.type === 'road' && (!object.points || !object.width)) throw new Error(`${label} needs points and a width`)
  if (object.type === 'house' && !object.ownerName) throw new Error(`${label} needs an owner name`)
  return object
}

export function parseLocalizedText(value: unknown, label: string): LocalizedText {
  const input = requireRecord(value, label)
  return { ko: trimmedText(input.ko, `${label}.ko`), en: trimmedText(input.en, `${label}.en`) }
}

export function parseOptionalLocalizedText(value: unknown, label: string): LocalizedText {
  return value === undefined || value === null ? { ko: '', en: '' } : parseLocalizedText(value, label)
}

export function parseFollowUp(value: unknown, label: string): ResidentDialogue['followUps'][number] {
  const followUp = requireRecord(value, label)
  return {
    question: parseLocalizedText(followUp.question, `${label}.question`),
    answer: parseLocalizedText(followUp.answer, `${label}.answer`),
  }
}

export function parseResidentDialogue(value: unknown, label: string): ResidentDialogue {
  const input = requireRecord(value, label)
  return {
    aboutOwner: parseLocalizedText(input.aboutOwner, `${label}.aboutOwner`),
    followUps: requireList(input.followUps, `${label}.followUps`).map((item, index) =>
      parseFollowUp(item, `${label}.followUps[${index}]`),
    ),
  }
}

export function parseResident(value: unknown, index: number): TownResident {
  const label = `residents[${index}]`
  const input = requireRecord(value, label)
  const name = trimmedText(input.name, `${label}.name`)
  const route = parsePoints(input.route, `${label}.route`)
  const seatIndex = finiteNumber(input.seatIndex, `${label}.seatIndex`)
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= route.length)
    throw new Error(`${label}.seatIndex must reference the route`)
  return {
    id: trimmedText(input.id, `${label}.id`),
    name,
    profile: normalizePlayerProfile({ ...requireRecord(input.appearance, `${label}.appearance`), name }),
    route,
    benchId: trimmedText(input.benchId, `${label}.benchId`),
    seatIndex,
    startSeated: input.startSeated === true,
    role: parseOptionalLocalizedText(input.role, `${label}.role`),
    relationship: parseOptionalLocalizedText(input.relationship, `${label}.relationship`),
    linkedInProfileUrl: normalizeLinkedInProfileUrl(input.linkedInProfileUrl) ?? undefined,
    reference: parseOptionalLocalizedText(input.reference, `${label}.reference`),
    dialogue:
      input.dialogue === undefined || input.dialogue === null
        ? null
        : parseResidentDialogue(input.dialogue, `${label}.dialogue`),
  }
}

export function pickStyle<Style extends string>(value: unknown, styles: readonly Style[], fallback: Style) {
  return styles.find((style) => style === value) ?? fallback
}

/** A town saved before movement styles existed, or naming a style this build lacks, moves the default way. */
export function parseMovement(value: unknown): TownMovement {
  const input = recordOrEmpty(value)
  return {
    gait: pickStyle(input.gait, GAIT_STYLES, DEFAULT_TOWN_MOVEMENT.gait),
    skid: pickStyle(input.skid, SKID_STYLES, DEFAULT_TOWN_MOVEMENT.skid),
  }
}

/** A town saved before venues existed plays the default ballpark; venue ids this build lacks are left out. */
export function parseVenues(value: unknown): TownVenues {
  return { ballpark: parseBallparkSettings(recordOrEmpty(value).ballpark) }
}

/** Falls back field by field, like movement styles, so a newer town still opens with what this build can show. */
export function parseBallparkSettings(value: unknown): BallparkSettings {
  const input = recordOrEmpty(value)
  const scheduledRules = parseScheduledRules(input.scheduledRules)
  return {
    theme: pickStyle(input.theme, BALLPARK_THEMES, DEFAULT_TOWN_VENUES.ballpark.theme),
    colors: Object.fromEntries(Object.entries(recordOrEmpty(input.colors)).filter(isBallparkColor)),
    rules: parseBallparkRules(input.rules),
    ...(scheduledRules ? { scheduledRules } : {}),
  }
}

/** An override this build can paint: a known role and a `#rrggbb` color. */
export function isBallparkColor(entry: [string, unknown]): entry is [BallparkColorRole, string] {
  return ballparkColorRoles.has(entry[0]) && isPlayerColor(entry[1])
}

export function parseBallparkRules(value: unknown): BallparkRules {
  const input = recordOrEmpty(value)
  const { pitchCount, difficulty } = DEFAULT_TOWN_VENUES.ballpark.rules
  return {
    pitchCount: isPitchCount(input.pitchCount) ? input.pitchCount : pitchCount,
    difficulty: pickStyle(input.difficulty, BASEBALL_DIFFICULTIES, difficulty),
  }
}

export function isPitchCount(value: unknown): value is number {
  const { minimum, maximum } = PITCH_COUNT_RANGE
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
}

/** A schedule without a `YYYY-MM` month cannot take over, so it is dropped and the rules in effect stay. */
export function parseScheduledRules(value: unknown): ScheduledBallparkRules | undefined {
  const input = recordOrEmpty(value)
  if (typeof input.fromMonth !== 'string' || !RANKING_MONTH_PATTERN.test(input.fromMonth)) return undefined
  return { fromMonth: input.fromMonth, rules: parseBallparkRules(input.rules) }
}

// The admin email shape in backend/src/admins.ts.
const emailPattern = /^[^\s@\p{Cc}]+@[^\s@\p{Cc}]+\.[^\s@\p{Cc}]+$/u
const emailLengthLimit = 254

/** The address as the backend stores it, or `null` for anything that is not one, which hides the contact button. */
export function normalizeContactEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return emailPattern.test(email) && email.length <= emailLengthLimit ? email : null
}

export function isGroundPoint(point: unknown): point is TownPoint {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    point.every((value) => typeof value === 'number' && Math.abs(value) <= TOWN_GROUND_LIMIT)
  )
}

/** The pet's own loop, or `null` (the default loop around the fountain) for anything that is not a walkable loop. */
export function parsePetRoute(value: unknown): TownPoint[] | null {
  if (!Array.isArray(value) || value.length < PET_ROUTE_POINTS.minimum) return null
  if (value.length > PET_ROUTE_POINTS.maximum || !value.every(isGroundPoint)) return null
  return value.map(([x, z]) => [x, z] as const)
}

/** A `residentId` naming none of `residents` reads as no owner's resident rather than failing the town. */
export function parseTownOwner(value: unknown, residents: readonly TownResident[]): TownOwner {
  const input = requireRecord(value, 'town.owner')
  return {
    name: parseLocalizedText(input.name, 'town.owner.name'),
    introduction:
      input.introduction === undefined || input.introduction === null
        ? null
        : parseLocalizedText(input.introduction, 'town.owner.introduction'),
    contactEmail: normalizeContactEmail(input.contactEmail),
    residentId: residents.find(({ id }) => id === input.residentId)?.id ?? null,
    questions:
      input.questions === undefined || input.questions === null
        ? []
        : requireList(input.questions, 'town.owner.questions').map((item, index) =>
            parseFollowUp(item, `town.owner.questions[${index}]`),
          ),
  }
}

/** The `mailto:` link behind every "Reach out" button; encoded, so an address cannot add recipients or a body. */
export function contactEmailHref(email: string) {
  return `mailto:${encodeURIComponent(email)}`
}

export function parseTownPet(value: unknown): TownPet {
  const input = requireRecord(value, 'town.pet')
  return { name: parseLocalizedText(input.name, 'town.pet.name'), route: parsePetRoute(input.route) }
}

export function parseTownLayout(value: unknown): TownSnapshot {
  const input = requireRecord(value, 'town')
  const objects = requireList(input.objects, 'town.objects')
    .map(parseObject)
    .filter((object) => object !== null)
  const residents = requireList(input.residents, 'town.residents').map(parseResident)
  const benchIds = new Set(objects.filter(({ type }) => type === 'bench').map(({ id }) => id))
  const strayResident = residents.find((resident) => !benchIds.has(resident.benchId))
  if (strayResident) throw new Error(`Resident ${strayResident.id} references an unknown bench`)
  return {
    id: trimmedText(input.id, 'town.id'),
    name: trimmedText(input.name, 'town.name'),
    owner: parseTownOwner(input.owner, residents),
    pet: parseTownPet(input.pet),
    spawn: parseVector(input.spawn, 'town.spawn'),
    movement: parseMovement(input.movement),
    venues: parseVenues(input.venues),
    objects,
    residents,
    revision: finiteNumber(input.revision, 'town.revision'),
  }
}

/** A text left blank in both languages is not written yet. */
export function unlessBlank(source: LocalizedText) {
  return source.ko.trim() || source.en.trim() ? source : null
}

/** The save body without `baseRevision`; residents keep only how they look, never a visitor's identity fields. */
export function serializeTownLayout(town: TownSnapshot) {
  return {
    name: town.name,
    owner: {
      name: town.owner.name,
      introduction: town.owner.introduction && unlessBlank(town.owner.introduction),
      contactEmail: town.owner.contactEmail?.trim() || null,
      residentId: town.owner.residentId,
      questions: town.owner.questions,
    },
    pet: town.pet,
    spawn: town.spawn,
    movement: town.movement,
    venues: town.venues,
    objects: town.objects.map((object) => ({ ...object, color: object.color ?? null })),
    residents: town.residents.map(({ profile, role, relationship, linkedInProfileUrl, reference, ...resident }) => ({
      ...resident,
      appearance: profileAppearance(profile),
      role: unlessBlank(role),
      relationship: unlessBlank(relationship),
      linkedInProfileUrl: linkedInProfileUrl || null,
      reference: unlessBlank(reference),
    })),
  }
}

/**
 * The town as saved. There is no built-in town to fall back on: a missing town (404) or an unreachable API rejects,
 * so visitors see the error screen and the editor pauses instead of starting from something else.
 */
export async function fetchTownLayout(townId: string, request: typeof fetch = fetch): Promise<TownSnapshot> {
  const response = await requestJson(`/v1/towns/${encodeURIComponent(townId)}`, {}, request)
  if (!response.ok) throw new Error(`Town API returned ${response.status}`)
  const town = parseTownLayout((await responseRecord(response)).town)
  if (town.id !== townId) throw new Error(`Town API returned ${town.id} instead of ${townId}`)
  return town
}

export class TownSaveError extends Error {
  constructor(readonly status: number) {
    super(`Town save returned ${status}`)
    this.name = 'TownSaveError'
  }
}

/** Saves from the revision the editor loaded; a 409 means another save happened since then. */
export async function saveTownLayout(town: TownSnapshot, request: typeof fetch = fetch): Promise<TownSnapshot> {
  const response = await requestJson(
    `/v1/admin/towns/${encodeURIComponent(town.id)}`,
    { method: 'PUT', body: JSON.stringify({ ...serializeTownLayout(town), baseRevision: town.revision }) },
    request,
  )
  if (!response.ok) throw new TownSaveError(response.status)
  return parseTownLayout((await responseRecord(response)).town)
}

export class DialogueDraftError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Dialogue draft returned ${status}: ${reason}`)
    this.name = 'DialogueDraftError'
  }
}

/**
 * Has the backend draft what `resident` says about the town owner, named `owner`, from their reference; nothing is
 * stored until the town is saved.
 */
export async function draftResidentDialogue(
  resident: Pick<TownResident, 'name' | 'role' | 'relationship' | 'reference'>,
  owner: LocalizedText,
  request: typeof fetch = fetch,
): Promise<ResidentDialogue> {
  const body = JSON.stringify({
    name: resident.name,
    owner,
    role: unlessBlank(resident.role),
    relationship: unlessBlank(resident.relationship),
    reference: resident.reference,
  })
  const response = await requestJson('/v1/admin/resident-dialogues', { method: 'POST', body }, request)
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new DialogueDraftError(response.status, responseErrorMessage(payload))
  return parseResidentDialogue(requireRecord(payload, 'response').dialogue, 'dialogue')
}

export function responseErrorMessage(payload: unknown) {
  const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null
  const message = error && typeof error === 'object' && 'message' in error ? error.message : null
  return typeof message === 'string' ? message : ''
}
