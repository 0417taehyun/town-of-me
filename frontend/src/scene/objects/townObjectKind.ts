import type { ComponentType, MutableRefObject } from 'react'
import type { Vector3 } from 'three'
import type { TownObject } from '../../data/models'
import type { AppLanguage } from '../../i18n/language'
import type { ContactShadowPatch } from '../contactShadow'
import type { DayPeriod } from '../environment/dayCycle'
import type { DayChange } from '../environment/dayTransition'
import type { SeasonChange } from '../environment/seasonTransition'
import type { WorldActor } from '../motion/npcMotion'
import type { CollisionBox, CollisionCircle } from '../townCollision'
import type { TownObjectVariant } from './variants'

/** What the town's layers draw with besides their objects; one object, shared by every layer. */
export type TownLayerProps = {
  seasonChange: MutableRefObject<SeasonChange>
  dayChange: MutableRefObject<DayChange>
  /** Sets how many birds and clouds are out. */
  period: DayPeriod
  lampsOn: boolean
  reducedMotion: boolean
  motionEnabled: boolean
  /** Holds every bird and cloud at its anchor, all of them visible, so the editor can place them. */
  editing: boolean
  playerPosition: MutableRefObject<Vector3>
  actors: MutableRefObject<WorldActor[]>
  language: AppLanguage
  /** The town's pet name in `language`. */
  petName: string
}

/** Draws every object of the kinds that share it, in town order, in as few meshes as it can. */
export type TownLayer = ComponentType<{ objects: TownObject[]; scene: TownLayerProps }>

export type TownColliders = { boxes?: CollisionBox[]; circles?: CollisionCircle[] }

/** The editor's tabs for placeable objects, in the order it shows them. */
export const TOWN_OBJECT_CATEGORIES = ['buildings', 'paths', 'nature', 'props', 'sky'] as const
export type TownObjectCategory = (typeof TOWN_OBJECT_CATEGORIES)[number]

/**
 * Everything the town knows about one kind of object. Kinds that share a layer, `colliders`, or `contactShadows`
 * function (the same function, not an equal one) get it called once with all of their objects.
 */
export type TownObjectKind = {
  /** The editor tab that lists this kind and whose markers can be picked while it is open. */
  category: TownObjectCategory
  /** What the editor's color picker shows while an object keeps its default; tinted models default to white. */
  defaultColor: string
  /** The editor offers to add one. */
  addable: boolean
  /** The town is built around exactly one, so the editor neither copies nor removes it. */
  singleton: boolean
  /** Placed in the sky: added at `defaultHeight`, and kept within `horizontalLimit` of the town's center. */
  sky?: { defaultHeight: number; horizontalLimit: number }
  /** Fields a new object starts with; a new house takes `newcomerName` as its owner until the admin names one. */
  defaults?: (newcomerName: string) => Partial<TownObject>
  /** The editor marker's radius. */
  markerRadius: number
  /** The looks the editor offers besides letting the id pick one; the same list as in `TOWN_OBJECT_VARIANTS`. */
  variants?: readonly TownObjectVariant[]
  /** Roads have none: they are painted into the ground. */
  Layer?: TownLayer
  /** What the player cannot walk through. */
  colliders?: (objects: TownObject[]) => TownColliders
  /** Soft dark patches where the objects meet the ground. */
  contactShadows?: (objects: TownObject[]) => ContactShadowPatch[]
}
