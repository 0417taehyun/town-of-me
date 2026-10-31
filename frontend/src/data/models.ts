import type { GaitStyle } from '../scene/motion/gait'
import type { SkidStyle } from '../scene/motion/skidTurn'
import { BIRD_VARIANTS, FLOWER_VARIANTS, TREE_VARIANTS } from '../scene/objects/variants'
import type { CameraSettings } from '../camera/cameraConfig'
import type { AppLanguage } from '../i18n/language'
import type { PlayerProfile } from './playerProfile'

export type Vec3 = { x: number; y: number; z: number }
export type TownPoint = readonly [number, number]

export type TownGuideStep =
  'inactive' | 'move' | 'glance' | 'view' | 'bench' | 'photo' | 'pet' | 'resident' | 'guestbook'

// The kinds this build can draw. The backend accepts any identifier, so a town may hold kinds an older build drops.
export const TOWN_OBJECT_TYPES = [
  'house',
  'dogHouse',
  'tree',
  'bench',
  'lamp',
  'rock',
  'flower',
  'weed',
  'bush',
  'mushroom',
  'pumpkin',
  'fountain',
  'guestbook',
  'road',
  'bird',
  'cloud',
] as const

export type TownObjectType = (typeof TOWN_OBJECT_TYPES)[number]

/** Variants this build can draw, by type; a saved variant missing here is dropped, and the object's id picks one. */
export type TownObjectVariants = Partial<Record<TownObjectType, readonly string[]>>

export const TOWN_OBJECT_VARIANTS: TownObjectVariants = {
  tree: TREE_VARIANTS,
  flower: FLOWER_VARIANTS,
  bird: BIRD_VARIANTS,
}

/** Every placeable thing in the town; the admin editor moves, recolors, adds, and removes them individually. */
export type TownObject = {
  id: string
  type: TownObjectType
  /** A drawing of `type` from `TOWN_OBJECT_VARIANTS`; omitted to let the id pick one (`resolveVariant`). */
  variant?: string
  position: Vec3
  /** Yaw in radians; birds and clouds use it as their travel heading. */
  rotation: number
  scale: number
  /** Omitted to keep the type's default (or seasonal) color. */
  color?: string
  /** bench */
  seats?: 1 | 2
  /** road: polyline points relative to `position` */
  points?: TownPoint[]
  /** road */
  width?: number
  /** house mailbox */
  ownerName?: string
  description?: string
  linkedInProfileUrl?: string
}

/** A resident walking the town; residents are registered by the admin and never sign in. */
export interface TownResident {
  id: string
  name: string
  profile: PlayerProfile
  /** Walking loop in world coordinates; `route[seatIndex]` is replaced by the approach to the bench. */
  route: TownPoint[]
  benchId: string
  seatIndex: number
  startSeated: boolean
  /** The resident's job, such as "Baker at the corner bakery"; empty strings until the admin writes it. */
  role: LocalizedText
  /** How the resident knows the town owner, such as "Neighbor for five years". */
  relationship: LocalizedText
  linkedInProfileUrl?: string
  /** What the resident says about the town owner, in both languages; visitors hear `dialogue` drafted from it. */
  reference: LocalizedText
  /** What visitors hear about the town owner, prepared and reviewed in the editor; `null` until then. */
  dialogue: ResidentDialogue | null
}

export type LocalizedText = Record<AppLanguage, string>

export interface ResidentDialogue {
  /** Answers "What kind of person is <owner>?" */
  aboutOwner: LocalizedText
  /** Questions the reference can answer, offered after `aboutOwner`. */
  followUps: Array<{ question: LocalizedText; answer: LocalizedText }>
}

/** How everyone moves in this town; the admin picks it and visitors see it after a save. */
export type TownMovement = { gait: GaitStyle; skid: SkidStyle }

export const DEFAULT_TOWN_MOVEMENT: TownMovement = { gait: 'plantedFeet', skid: 'long' }

/** Someone the town's copy names, such as its owner or the pet. */
export type TownCharacter = { name: LocalizedText }

export type TownOwner = TownCharacter & {
  /** Shown to visitors before they make a character; `null` skips that step. */
  introduction: LocalizedText | null
  /** Behind the HUD's contact button; `null` hides it. */
  contactEmail: string | null
  /** The resident who is the owner, answering "Who are you?" with `introduction`; `null` when none is. */
  residentId: string | null
  /** What visitors can ask the owner's resident after "Who are you?". */
  questions: ResidentDialogue['followUps']
}

export type TownPet = TownCharacter & {
  /** A closed walking loop; `null` walks the default loop around the fountain. */
  route: TownPoint[] | null
}

// Mirrors groundBounds and the pet route limits in backend/src/town.ts: ground points stay inside the boundary walls.
export const TOWN_GROUND_LIMIT = 52
export const PET_ROUTE_POINTS = { minimum: 3, maximum: 32 } as const

export type TownSnapshot = {
  id: string
  name: string
  owner: TownOwner
  pet: TownPet
  spawn: Vec3
  movement: TownMovement
  objects: TownObject[]
  residents: TownResident[]
  /** Grows with every save; a save must start from the current revision. */
  revision: number
}

export type DemoSession = {
  townId: string
  playerPosition: Vec3
  camera: CameraSettings
  profile?: PlayerProfile
  ui: { instructionsDismissed: boolean; guideStep?: TownGuideStep }
}
