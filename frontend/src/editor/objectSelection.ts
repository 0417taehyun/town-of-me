import { Vector3, type Camera } from 'three'
import type { TownObject, TownObjectType, TownPoint, TownSnapshot, Vec3 } from '../data/models'
import { damp } from '../motionMath'
import { getPetRoute } from '../scene/animals/corgiGait'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { TOWN_OBJECT_CATEGORIES, type TownObjectCategory } from '../scene/objects/townObjectKind'
import { getMarkerPosition, getResidentWalk, isSkyObject, type EditorSelection } from './townEditing'

/** The editor's tabs: the object categories, then the residents and the pet's walk, which are not objects. */
export type EditorCategory = TownObjectCategory | 'people'

export const EDITOR_CATEGORIES: readonly EditorCategory[] = [...TOWN_OBJECT_CATEGORIES, 'people']

/** The kinds a tab lists, in registry order; `people` lists none. */
export function getCategoryTypes(category: EditorCategory): TownObjectType[] {
  return (Object.keys(TOWN_OBJECT_KINDS) as TownObjectType[]).filter(
    (type) => TOWN_OBJECT_KINDS[type].category === category,
  )
}

export function isInCategory(object: TownObject, category: EditorCategory) {
  return TOWN_OBJECT_KINDS[object.type].category === category
}

/** `open` markers can be picked, `selected` ones stand out, and `dimmed` ones belong to another tab. */
export type MarkerLook = 'open' | 'selected' | 'dimmed'

export function getMarkerLook(object: TownObject, category: EditorCategory, selectedIds: ReadonlySet<string>) {
  if (!isInCategory(object, category)) return 'dimmed'
  return selectedIds.has(object.id) ? 'selected' : 'open'
}

/**
 * The map's markers in layers by look, each on the ground and in the sky. Only the open tab's layers can be picked;
 * the other tabs' are faded and let the pointer through.
 */
export function getMarkerLayers(
  objects: readonly TownObject[],
  category: EditorCategory,
  selectedIds: ReadonlySet<string>,
) {
  const layer = (look: MarkerLook, sky: boolean) => ({
    key: `${look}-${sky ? 'sky' : 'ground'}`,
    look,
    ground: !sky,
    objects: objects.filter(
      (object) => getMarkerLook(object, category, selectedIds) === look && isSkyObject(object.type) === sky,
    ),
  })
  return (['open', 'selected', 'dimmed'] as const).flatMap((look) => [layer(look, false), layer(look, true)])
}

/** The kind whose list holds the one selected object, when it is one of `types`. */
export function getListedType(town: TownSnapshot, selection: EditorSelection, types: readonly TownObjectType[]) {
  const objects = getSelectedObjects(town, selection)
  return objects.length === 1 && types.includes(objects[0].type) ? objects[0].type : null
}

export function getSelectedObjectIds(selection: EditorSelection): readonly string[] {
  if (selection?.kind === 'objects') return selection.ids
  return selection?.kind === 'object' ? [selection.id] : []
}

/** The tab that shows `selection`: the people tab for a resident or the pet's walk, or the first object's tab. */
export function getSelectionCategory(town: TownSnapshot, selection: EditorSelection): EditorCategory | null {
  if (selection?.kind === 'resident' || selection?.kind === 'pet') return 'people'
  const [id] = getSelectedObjectIds(selection)
  const object = town.objects.find((candidate) => candidate.id === id)
  return object ? TOWN_OBJECT_KINDS[object.type].category : null
}

/** The selected objects that still exist, in town order; an undo can remove objects that stay selected. */
export function getSelectedObjects(town: TownSnapshot, selection: EditorSelection) {
  const ids = new Set(getSelectedObjectIds(selection))
  return town.objects.filter(({ id }) => ids.has(id))
}

/** Exactly these objects: nothing, one object with its own inspector, or several. */
export function selectObjects(ids: readonly string[]): EditorSelection {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return null
  return unique.length === 1 ? { kind: 'object', id: unique[0] } : { kind: 'objects', ids: unique }
}

/** Adds the object if it is not selected and removes it if it is; a resident or the pet's walk gives way to it. */
export function toggleObjectSelection(selection: EditorSelection, id: string): EditorSelection {
  const ids = getSelectedObjectIds(selection)
  return selectObjects(ids.includes(id) ? ids.filter((selected) => selected !== id) : [...ids, id])
}

export function addToObjectSelection(selection: EditorSelection, ids: readonly string[]): EditorSelection {
  return selectObjects([...getSelectedObjectIds(selection), ...ids])
}

/** The ids from the anchor to `id` in list order, either way round; only `id` when the anchor is not in the list. */
export function getListRange(listIds: readonly string[], anchorId: string | null, id: string): string[] {
  const from = anchorId === null ? -1 : listIds.indexOf(anchorId)
  const to = listIds.indexOf(id)
  if (from < 0 || to < 0) return [id]
  return listIds.slice(Math.min(from, to), Math.max(from, to) + 1)
}

export type ScreenPoint = { x: number; y: number }

/** The ids of the points inside the rectangle between two corners, dragged either way; its edges count as inside. */
export function getIdsInRectangle(
  points: ReadonlyArray<ScreenPoint & { id: string }>,
  corner: ScreenPoint,
  oppositeCorner: ScreenPoint,
) {
  const left = Math.min(corner.x, oppositeCorner.x)
  const right = Math.max(corner.x, oppositeCorner.x)
  const top = Math.min(corner.y, oppositeCorner.y)
  const bottom = Math.max(corner.y, oppositeCorner.y)
  return points.filter(({ x, y }) => x >= left && x <= right && y >= top && y <= bottom).map(({ id }) => id)
}

/**
 * Where each object's marker shows on the page, in client pixels: ground markers on the ground, sky markers at their
 * height. Markers behind the camera are left out.
 */
export function projectMarkers(objects: readonly TownObject[], camera: Camera, canvas: DOMRect) {
  const projected = new Vector3()
  return objects
    .map((object) => {
      const { x, y, z } = getMarkerPosition(object)
      projected.set(x, isSkyObject(object.type) ? y : 0, z).project(camera)
      return {
        id: object.id,
        x: canvas.left + ((projected.x + 1) / 2) * canvas.width,
        y: canvas.top + ((1 - projected.y) / 2) * canvas.height,
        inFront: projected.z < 1,
      }
    })
    .filter(({ inFront }) => inFront)
}

/** How quickly the camera glides to what was chosen from a list, per second. */
const FOCUS_RATE = 6

/**
 * Moves the camera and its target together toward `focus`, so the view keeps its height and heading on the way.
 * Returns true once the target has arrived.
 */
export function glideToFocus(target: Vector3, position: Vector3, focus: Vec3, delta: number) {
  const stepX = damp(target.x, focus.x, FOCUS_RATE, delta) - target.x
  const stepZ = damp(target.z, focus.z, FOCUS_RATE, delta) - target.z
  target.x += stepX
  target.z += stepZ
  position.x += stepX
  position.z += stepZ
  return Math.hypot(focus.x - target.x, focus.z - target.z) < 0.05
}

export function getPointsCenter(points: readonly TownPoint[]): Vec3 {
  const x = points.reduce((sum, [pointX]) => sum + pointX, 0) / Math.max(1, points.length)
  const z = points.reduce((sum, [, pointZ]) => sum + pointZ, 0) / Math.max(1, points.length)
  return { x, y: 0, z }
}

/** Where the camera looks when the selection is chosen from a list: the object, or the middle of the walk. */
export function getFocusPoint(town: TownSnapshot, selection: EditorSelection): Vec3 | null {
  const [object] = getSelectedObjects(town, selection)
  if (object) return getMarkerPosition(object)
  const resident = selection?.kind === 'resident' ? town.residents.find(({ id }) => id === selection.id) : undefined
  if (resident) return getPointsCenter(getResidentWalk(town, resident))
  if (selection?.kind !== 'pet') return null
  const fountain = town.objects.find(({ type }) => type === 'fountain')
  return getPointsCenter(getPetRoute(town.pet, fountain?.position))
}
