import { isDeepStrictEqual } from 'node:util'
import { adminEmail } from './admins.js'
import { linkedInProfileUrl, parseCharacterAppearance, type CharacterAppearance } from './character.js'
import { locales, type LocalizedText } from './domain.js'
import {
  boundedInteger,
  boundedNumber,
  hexColor,
  inputList,
  inputRecord,
  invalidInput,
  matchingText,
  multilineText,
  oneOf,
  optionalInput,
  parseFields,
  singleLineText,
} from './validation.js'

export type TownPoint = readonly [number, number]
export type TownVector = Readonly<{ x: number; y: number; z: number }>

/**
 * One placeable thing in the town; only the listed type-specific fields are kept for each type. The frontend owns
 * the catalog of types and variants and drops what it does not know, so new kinds need no backend change.
 */
export interface TownObject {
  id: string
  /** A camelCase kind such as `tree`; only bench, road, house, fountain, and guestbook have rules beyond the shape. */
  type: string
  /** A look within the kind, such as `pine` for a tree. */
  variant?: string
  position: TownVector
  rotation: number
  scale: number
  /** `null` keeps the frontend's default (or seasonal) color for the type. */
  color: string | null
  /** bench */
  seats?: 1 | 2
  /** road: polyline points relative to `position` */
  points?: readonly TownPoint[]
  /** road */
  width?: number
  /** house mailbox */
  ownerName?: string
  description?: string
  linkedInProfileUrl?: string
}

/** A resident walking around the town; residents are curated by the admin and never sign in. */
export interface TownResident {
  id: string
  name: string
  appearance: CharacterAppearance
  /** Walking loop in world coordinates; `route[seatIndex]` is replaced by the approach to the bench. */
  route: readonly TownPoint[]
  benchId: string
  seatIndex: number
  startSeated: boolean
  /** The resident's job, such as "Head of Infrastructure at a bakery chain"; the frontend introduces them from it. */
  role: LocalizedText | null
  /** How the resident knows the town owner, such as "Colleague in the Infrastructure Division". */
  relationship: LocalizedText | null
  linkedInProfileUrl: string | null
  /** What the resident says about the owner, written by the admin in both languages; visitors hear `dialogue`. */
  reference: LocalizedText | null
  dialogue: ResidentDialogue | null
}

/** Lines prepared ahead of time from the reference, so a conversation never waits for or depends on an LLM. */
export interface ResidentDialogue {
  /** Answers "Who are you?" in the resident's own words; dialogue saved before it existed has none. */
  aboutResident?: LocalizedText
  /** Answers "What kind of person is <owner>?" */
  aboutOwner: LocalizedText
  /** Questions the reference can answer, offered to the visitor after `aboutOwner`. */
  followUps: ReadonlyArray<{ question: LocalizedText; answer: LocalizedText }>
}

/**
 * `role` and `relationship` give the resident's introduction and set their voice; every other line comes from
 * `reference`. `owner` is the town owner's name, whom the lines are about.
 */
export type ResidentDialogueSource = Pick<TownResident, 'name' | 'role' | 'relationship'> & {
  reference: LocalizedText
  owner: LocalizedText
}

/** How every character in the town walks and stops; the frontend owns each style and maps unknown ones. */
export interface TownMovement {
  gait: string
  skid: string
}

/** The town owner, named in both languages wherever visitors meet them. */
export interface TownOwner {
  name: LocalizedText
  /** Shown before the character creator; `null` skips that step. */
  introduction: LocalizedText | null
  /** Opened as a `mailto:` link by the contact button; `null` hides the button. */
  contactEmail: string | null
  /** Offered beside the contact email when visitors ask the owner's resident who they are; canonical when set. */
  linkedInProfileUrl: string | null
  /** The resident who is the owner, so visitors can walk up and talk to them; `null` when no resident is. */
  residentId: string | null
  /** What visitors may ask the owner after the introduction, answered in the owner's own words. */
  questions: ResidentDialogue['followUps']
}

/** The owner's pet, named in both languages wherever visitors meet it. */
export interface TownPet {
  name: LocalizedText
  /** Walking loop in world coordinates; `null` walks the frontend's default loop around the fountain. */
  route: readonly TownPoint[] | null
}

/**
 * What every venue has: whether visitors see it, and its look. The frontend owns the themes and their color roles, so
 * only the shape is checked here.
 */
export interface VenueLook {
  /** The admin's switch; like the look, it applies as soon as the town is saved. */
  visible: boolean
  /** A theme id such as `garden`. */
  theme: string
  /** Only the roles the admin overrides, such as `roof`; every other role keeps the theme's color. */
  colors: Record<string, string>
}

/** What a ballpark game is played by; ranked runs will snapshot them, so they are checked exactly. */
export interface BallparkRules {
  pitchCount: number
  difficulty: BallparkDifficulty
}

/** Rules that take over at the start of `fromMonth`, a KST calendar month written `YYYY-MM`. */
export interface ScheduledBallparkRules {
  fromMonth: string
  rules: BallparkRules
}

export interface BallparkSettings extends VenueLook {
  /** The rules in effect. Only the server changes them, by promoting a schedule whose month has come. */
  rules: BallparkRules
  /** Present only while a change is scheduled. */
  scheduledRules?: ScheduledBallparkRules
}

/** The large venues at the town's edge, keyed by venue id; a new venue adds its key here and to `parseTownVenues`. */
export interface TownVenues {
  ballpark: BallparkSettings
}

export interface TownLayout {
  name: string
  owner: TownOwner
  pet: TownPet
  spawn: TownVector
  movement: TownMovement
  venues: TownVenues
  objects: readonly TownObject[]
  residents: readonly TownResident[]
  /** Increases on every save; a save names the revision it started from so a stale editor cannot overwrite. */
  revision: number
  updatedAt: string
}

export type TownLayoutInput = Pick<
  TownLayout,
  'name' | 'owner' | 'pet' | 'spawn' | 'movement' | 'venues' | 'objects' | 'residents'
>

const townIdentifierPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u
const kindPattern = /^[a-z][A-Za-z0-9]{0,31}$/u
const variantPattern = /^[a-z][A-Za-z0-9-]{0,31}$/u
// The playable ground ends at the boundary walls (±53), which bounds the spawn, roads, and resident routes.
const groundBounds = { horizontal: 52, minimumHeight: -1, maximumHeight: 10 }
// Objects share one generous box so birds and clouds may drift past the walls; the frontend owns per-kind placement.
const objectBounds = { horizontal: 120, minimumHeight: -1, maximumHeight: 40 }
// The plaza, the pet's walk, and the guestbook interaction are built around exactly one of each.
const singletonTypes = ['fountain', 'guestbook'] as const
const objectLimit = 800
const residentLimit = 24
const routePointLimit = 32
const introductionLimit = 600
const sourceTextLimit = 2_000
const dialogueLineLimit = 400
const shortLineLimit = 80
const characterNameLimit = 24
export const followUpLimit = 3
const ownerQuestionLimit = 5
// Mirrors frontend/src/data/models.ts BASEBALL_DIFFICULTIES, PITCH_COUNT_RANGE, DEFAULT_TOWN_VENUES, and
// RANKING_MONTH_PATTERN. Stored towns are read with these same checks, so a published range or id is never narrowed
// without a data migration.
const ballparkDifficulties = ['easy', 'normal', 'hard'] as const
// At least three pitches, so each of the three pitch types comes up at least once.
const ballparkPitchCountRange = { minimum: 3, maximum: 10 }
const defaultBallparkRules: BallparkRules = { pitchCount: 5, difficulty: 'normal' }
const rankingMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/u
const venueColorLimit = 12
// Korea keeps no daylight saving time, so a fixed offset gives the KST calendar month.
const kstOffsetMs = 9 * 60 * 60 * 1000

type Bounds = typeof groundBounds
export type BallparkDifficulty = (typeof ballparkDifficulties)[number]

/** Validates a whole layout, including references between residents and benches, before it may be stored. */
export function parseTownLayout(value: unknown): TownLayoutInput {
  const input = inputRecord(value, 'town')
  const objects = inputList(input.objects, 'objects', objectLimit).map(parseTownObject)
  const residents = inputList(input.residents, 'residents', residentLimit).map(parseTownResident)
  assertUniqueIds(objects, 'object')
  assertUniqueIds(residents, 'resident')
  singletonTypes.forEach((type) => assertSingleton(objects, type))
  const benchIds = new Set(objects.filter(({ type }) => type === 'bench').map(({ id }) => id))
  const strayResident = residents.find((resident) => !benchIds.has(resident.benchId))
  if (strayResident) throw invalidInput(`resident ${strayResident.id} references an unknown bench`)
  const owner = parseTownOwner(input.owner)
  if (owner.residentId !== null && !residents.some(({ id }) => id === owner.residentId)) {
    throw invalidInput(`owner.residentId ${owner.residentId} references an unknown resident`)
  }
  return {
    name: singleLineText(input.name, 'name', 60),
    owner,
    pet: parseTownPet(input.pet),
    spawn: townVector(input.spawn, 'spawn', groundBounds),
    movement: parseTownMovement(input.movement),
    venues: parseTownVenues(input.venues),
    objects,
    residents,
  }
}

// Towns saved before the introduction, contact email, LinkedIn link, owner's resident, questions, and pet route existed
// keep working, so each may be omitted. The layout checks that `residentId` names one of its residents.
export function parseTownOwner(value: unknown): TownOwner {
  const input = inputRecord(value, 'owner')
  return {
    name: characterName(input.name, 'owner.name'),
    introduction: optionalInput(input.introduction, (introduction) =>
      localizedText(introduction, 'owner.introduction', multilineText, introductionLimit),
    ),
    contactEmail: optionalInput(input.contactEmail, (email) => adminEmail(email, 'owner.contactEmail')),
    linkedInProfileUrl: linkedInProfileUrl(input.linkedInProfileUrl),
    residentId: optionalInput(input.residentId, (residentId) => townIdentifier(residentId, 'owner.residentId')),
    questions: parseFollowUps(input.questions ?? [], 'owner.questions', ownerQuestionLimit),
  }
}

export function parseTownPet(value: unknown): TownPet {
  const input = inputRecord(value, 'pet')
  return {
    name: characterName(input.name, 'pet.name'),
    route: optionalInput(input.route, (route) =>
      townPoints(route, 'pet.route', routePointLimit, groundBounds.horizontal, 3),
    ),
  }
}

/** The owner's or the pet's name: one line of 1 to 24 characters in each language. */
export function characterName(value: unknown, field: string): LocalizedText {
  return localizedText(value, field, singleLineText, characterNameLimit)
}

// Towns saved before the movement setting existed keep the original walk, so either field may be omitted.
export function parseTownMovement(value: unknown): TownMovement {
  const input = inputRecord(value ?? {}, 'movement')
  return {
    gait: kindName(input.gait ?? 'plantedFeet', 'movement.gait'),
    skid: kindName(input.skid ?? 'long', 'movement.skid'),
  }
}

// Towns saved before venues existed play the default ballpark, and unknown venue ids are dropped like unlisted fields.
export function parseTownVenues(value: unknown): TownVenues {
  const input = inputRecord(value ?? {}, 'venues')
  return { ballpark: parseBallparkSettings(input.ballpark) }
}

export function parseBallparkSettings(value: unknown): BallparkSettings {
  const field = 'venues.ballpark'
  const input = inputRecord(value ?? {}, field)
  const scheduledRules = optionalInput(input.scheduledRules, parseScheduledBallparkRules)
  return {
    ...parseVenueLook(input, field, 'garden'),
    rules: parseBallparkRules(input.rules, `${field}.rules`),
    ...(scheduledRules ? { scheduledRules } : {}),
  }
}

export function parseVenueLook(input: Record<string, unknown>, field: string, defaultTheme: string): VenueLook {
  // A venue stays hidden until the admin shows it, also in towns saved before the switch existed.
  const visible = input.visible ?? false
  if (typeof visible !== 'boolean') throw invalidInput(`${field}.visible must be a boolean`)
  return {
    visible,
    theme: kindName(input.theme ?? defaultTheme, `${field}.theme`),
    colors: venueColors(input.colors ?? {}, `${field}.colors`),
  }
}

/** Color overrides by role: role names have the shape of kinds, and colors are stored in lowercase. */
export function venueColors(value: unknown, field: string): Record<string, string> {
  const entries = Object.entries(inputRecord(value, field))
  if (entries.length > venueColorLimit) throw invalidInput(`${field} may name at most ${venueColorLimit} colors`)
  return Object.fromEntries(
    entries.map(([role, color]) => [kindName(role, `${field} role`), hexColor(color, `${field}.${role}`)]),
  )
}

/** An omitted field takes the default rule. */
export function parseBallparkRules(value: unknown, field: string): BallparkRules {
  const input = inputRecord(value ?? {}, field)
  const { minimum, maximum } = ballparkPitchCountRange
  return {
    pitchCount: boundedInteger(
      input.pitchCount ?? defaultBallparkRules.pitchCount,
      `${field}.pitchCount`,
      minimum,
      maximum,
    ),
    difficulty: oneOf(input.difficulty ?? defaultBallparkRules.difficulty, ballparkDifficulties, `${field}.difficulty`),
  }
}

// Only the shape is checked here, so a stored schedule whose month has come still reads; saves check the month.
export function parseScheduledBallparkRules(value: unknown): ScheduledBallparkRules {
  const field = 'venues.ballpark.scheduledRules'
  const input = inputRecord(value, field)
  return {
    fromMonth: rankingMonthInput(input.fromMonth, `${field}.fromMonth`),
    rules: parseBallparkRules(input.rules, `${field}.rules`),
  }
}

// Mirrors frontend/src/data/ballparkRules.ts rankingMonth, nextRankingMonth, and effectiveBallparkRules.

/** The KST calendar month, `YYYY-MM`, that `now` falls in, whatever the time zone of the machine. */
export function rankingMonth(now: number): string {
  return new Date(now + kstOffsetMs).toISOString().slice(0, 7)
}

/** The ranking month after a `YYYY-MM` month: the only month a new or changed schedule may start in. */
export function nextRankingMonth(month: string): string {
  // Date.UTC counts months from 0, so the 1-based month number is already the month after.
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7)
}

/** A `YYYY-MM` ranking month as a client writes it; whether that month has come is up to the caller. */
export function rankingMonthInput(value: unknown, field: string): string {
  return matchingText(value, rankingMonthPattern, field, 'a YYYY-MM month')
}

/** When a `YYYY-MM` ranking month starts: 00:00 KST on its first day, in epoch ms. */
export function rankingMonthStart(month: string): number {
  return Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) - kstOffsetMs
}

/** The KST calendar day, `YYYY-MM-DD`, that an ISO time falls on. */
export function rankingDay(time: string): string {
  return new Date(Date.parse(time) + kstOffsetMs).toISOString().slice(0, 10)
}

/** The rules played in `month`; `YYYY-MM` months sort as text. */
export function effectiveBallparkRules(ballpark: BallparkSettings, month: string): BallparkRules {
  const scheduled = ballpark.scheduledRules
  return scheduled && scheduled.fromMonth <= month ? scheduled.rules : ballpark.rules
}

/**
 * The server owns the rules in effect, so within one KST month they never change: a save keeps the stored rules for
 * `month`, promoting a schedule whose month has come, and ignores the submitted ones, so a stale editor tab neither
 * fails nor changes them. A town saved for the first time starts with the default rules. Visibility and the look apply
 * at once.
 */
export function settleBallparkSettings(
  submitted: BallparkSettings,
  stored: BallparkSettings | null,
  month: string,
): BallparkSettings {
  const rules = stored ? effectiveBallparkRules(stored, month) : defaultBallparkRules
  const scheduledRules = settleScheduledRules(submitted.scheduledRules, stored?.scheduledRules, month)
  return {
    visible: submitted.visible,
    theme: submitted.theme,
    colors: submitted.colors,
    rules,
    ...(scheduledRules ? { scheduledRules } : {}),
  }
}

/**
 * A new or changed schedule must start in the month after `month`, the server's KST month, so an admin device whose
 * clock is off near a month boundary gets an error instead of a schedule shifted to another month. The stored schedule
 * sent back unchanged is kept until its month comes; from then on it is a stale tab rather than a mistake, and
 * `settleBallparkSettings` has already promoted it, so it is dropped.
 */
export function settleScheduledRules(
  submitted: ScheduledBallparkRules | undefined,
  stored: ScheduledBallparkRules | undefined,
  month: string,
): ScheduledBallparkRules | undefined {
  if (!submitted) return undefined
  if (isDeepStrictEqual(submitted, stored)) return submitted.fromMonth > month ? submitted : undefined
  const nextMonth = nextRankingMonth(month)
  if (submitted.fromMonth === nextMonth) return submitted
  throw invalidInput(`venues.ballpark.scheduledRules.fromMonth must be ${nextMonth}, the KST month after ${month}`)
}

export function parseTownObject(value: unknown, index: number): TownObject {
  const label = `objects[${index}]`
  const input = inputRecord(value, label)
  const type = kindName(input.type, `${label}.type`)
  const variant = optionalInput(input.variant, (text) => variantName(text, `${label}.variant`))
  return {
    id: townIdentifier(input.id, `${label}.id`),
    type,
    ...(variant ? { variant } : {}),
    position: townVector(input.position, `${label}.position`, objectBounds),
    rotation: boundedNumber(input.rotation ?? 0, `${label}.rotation`, -Math.PI * 2, Math.PI * 2),
    scale: boundedNumber(input.scale ?? 1, `${label}.scale`, 0.2, 4),
    color: optionalInput(input.color, (color) => hexColor(color, `${label}.color`)),
    ...townObjectTypeProperties(type, input, label),
  }
}

/** An object type, a gait, or a skid: the frontend owns the catalog, so only the shape is checked here. */
export function kindName(value: unknown, field: string): string {
  return matchingText(value, kindPattern, field, 'a lowercase letter followed by up to 31 letters or digits')
}

export function variantName(value: unknown, field: string): string {
  return matchingText(
    value,
    variantPattern,
    field,
    'a lowercase letter followed by up to 31 letters, digits, or hyphens',
  )
}

export function townObjectTypeProperties(type: string, input: Record<string, unknown>, label: string) {
  if (type === 'bench') return { seats: benchSeats(input.seats, `${label}.seats`) }
  if (type === 'road') {
    return {
      points: townPoints(input.points, `${label}.points`, 64, groundBounds.horizontal + 8),
      width: boundedNumber(input.width, `${label}.width`, 1, 12),
    }
  }
  if (type === 'house') return houseProperties(input, label)
  return {}
}

export function houseProperties(input: Record<string, unknown>, label: string) {
  const description =
    input.description === undefined || input.description === ''
      ? null
      : singleLineText(input.description, `${label}.description`, 120)
  const profileUrl = linkedInProfileUrl(input.linkedInProfileUrl)
  return {
    ownerName: singleLineText(input.ownerName, `${label}.ownerName`, 40),
    ...(description ? { description } : {}),
    ...(profileUrl ? { linkedInProfileUrl: profileUrl } : {}),
  }
}

export function parseTownResident(value: unknown, index: number): TownResident {
  const label = `residents[${index}]`
  const input = inputRecord(value, label)
  const route = townPoints(input.route, `${label}.route`, routePointLimit, groundBounds.horizontal)
  const seatIndex = input.seatIndex
  if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= route.length) {
    throw invalidInput(`${label}.seatIndex must reference a route point`)
  }
  if (input.startSeated !== undefined && typeof input.startSeated !== 'boolean') {
    throw invalidInput(`${label}.startSeated must be a boolean`)
  }
  return {
    id: townIdentifier(input.id, `${label}.id`),
    name: singleLineText(input.name, `${label}.name`, 24),
    appearance: parseCharacterAppearance(input.appearance, `${label}.appearance`),
    route,
    benchId: townIdentifier(input.benchId, `${label}.benchId`),
    seatIndex,
    startSeated: input.startSeated === true,
    ...residentProfile(input, label),
    linkedInProfileUrl: linkedInProfileUrl(input.linkedInProfileUrl),
    reference: optionalInput(input.reference, (reference) => residentReference(reference, `${label}.reference`)),
    dialogue: optionalInput(input.dialogue, (dialogue) => parseResidentDialogue(dialogue, `${label}.dialogue`)),
  }
}

export function residentProfile(input: Record<string, unknown>, label: string) {
  return {
    role: optionalInput(input.role, (role) => shortLocalizedLine(role, `${label}.role`)),
    relationship: optionalInput(input.relationship, (relationship) =>
      shortLocalizedLine(relationship, `${label}.relationship`),
    ),
  }
}

/** What the admin sends to have a resident's dialogue drafted. */
export function parseResidentDialogueSource(value: unknown): ResidentDialogueSource {
  const input = inputRecord(value, 'resident')
  return {
    name: singleLineText(input.name, 'name', 24),
    ...residentProfile(input, 'resident'),
    reference: residentReference(input.reference, 'reference'),
    owner: characterName(input.owner, 'owner'),
  }
}

/** Applies to both admin-edited and generated dialogue, so a draft that passes here can always be saved. */
export function parseResidentDialogue(value: unknown, field: string): ResidentDialogue {
  const input = inputRecord(value, field)
  const aboutResident = optionalInput(input.aboutResident, (line) => dialogueLine(line, `${field}.aboutResident`))
  return {
    ...(aboutResident ? { aboutResident } : {}),
    aboutOwner: dialogueLine(input.aboutOwner, `${field}.aboutOwner`),
    followUps: parseFollowUps(input.followUps, `${field}.followUps`, followUpLimit),
  }
}

/** A resident's follow-ups or the owner's own questions: `{ question, answer }` pairs a visitor may ask. */
export function parseFollowUps(value: unknown, field: string, maximumCount: number): ResidentDialogue['followUps'] {
  return inputList(value, field, maximumCount).map((followUp, index) => parseFollowUp(followUp, `${field}[${index}]`))
}

export function parseFollowUp(value: unknown, field: string): ResidentDialogue['followUps'][number] {
  const input = inputRecord(value, field)
  return {
    question: shortLocalizedLine(input.question, `${field}.question`),
    answer: dialogueLine(input.answer, `${field}.answer`),
  }
}

export function residentReference(value: unknown, field: string): LocalizedText {
  return localizedText(value, field, multilineText, sourceTextLimit)
}

export function dialogueLine(value: unknown, field: string): LocalizedText {
  return localizedText(value, field, multilineText, dialogueLineLimit)
}

/** A role, a relationship, or a follow-up question: one short line in each language. */
export function shortLocalizedLine(value: unknown, field: string): LocalizedText {
  return localizedText(value, field, singleLineText, shortLineLimit)
}

export function localizedText(
  value: unknown,
  field: string,
  parseText: typeof singleLineText,
  maximumLength: number,
): LocalizedText {
  return parseFields(inputRecord(value, field), locales, (text, locale) =>
    parseText(text, `${field}.${locale}`, maximumLength),
  )
}

export function assertUniqueIds(items: ReadonlyArray<{ id: string }>, kind: string): void {
  const ids = items.map(({ id }) => id)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate) throw invalidInput(`${kind} id ${duplicate} is used more than once`)
}

export function assertSingleton(objects: readonly TownObject[], type: string): void {
  const count = objects.filter((object) => object.type === type).length
  if (count !== 1) throw invalidInput(`the town needs exactly one ${type}`)
}

export function benchSeats(value: unknown, field: string): 1 | 2 {
  if (value === undefined) return 2
  if (value !== 1 && value !== 2) throw invalidInput(`${field} must be 1 or 2`)
  return value
}

export function townPoints(
  value: unknown,
  field: string,
  maximumCount: number,
  limit: number,
  minimumCount = 2,
): TownPoint[] {
  return inputList(value, field, maximumCount, minimumCount).map((point, index) =>
    townPoint(point, `${field}[${index}]`, limit),
  )
}

export function townPoint(value: unknown, field: string, limit: number): TownPoint {
  if (!Array.isArray(value) || value.length !== 2) throw invalidInput(`${field} must be [x, z]`)
  return [boundedNumber(value[0], `${field}[0]`, -limit, limit), boundedNumber(value[1], `${field}[1]`, -limit, limit)]
}

export function townVector(value: unknown, field: string, bounds: Bounds): TownVector {
  const input = inputRecord(value, field)
  return {
    x: boundedNumber(input.x, `${field}.x`, -bounds.horizontal, bounds.horizontal),
    y: boundedNumber(input.y, `${field}.y`, bounds.minimumHeight, bounds.maximumHeight),
    z: boundedNumber(input.z, `${field}.z`, -bounds.horizontal, bounds.horizontal),
  }
}

export function townIdentifier(value: unknown, field: string): string {
  return matchingText(value, townIdentifierPattern, field, '1 to 64 lowercase letters, digits, or hyphens')
}
