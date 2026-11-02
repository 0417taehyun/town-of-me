import type { TownObject } from '../data/models'
import { clamp } from '../motionMath'
import { groupByKind } from './objects/kinds'

/** How far the player's body reaches from its center across the ground. */
export const PLAYER_RADIUS = 0.42

export type PlanarPoint = { x: number; z: number }
export type CollisionCircle = PlanarPoint & { radius: number }
/** A rectangle centered on its point and turned by the angle whose cosine and sine it keeps. */
export type CollisionBox = PlanarPoint & { halfWidth: number; halfDepth: number; cosine: number; sine: number }
/** Everything solid stands on the flat ground and rises past the player's knees, so only its footprint matters. */
export type TownCollision = { boxes: CollisionBox[]; circles: CollisionCircle[] }
/** Something moving that the player bumps into, like a resident or the pet. */
export type CollisionActor = { position: PlanarPoint; radius: number }

/** The fence around the town, as thick slabs so a fast step cannot cross them. */
const TOWN_WALLS: CollisionBox[] = [
  { x: 0, z: -53, halfWidth: 54, halfDepth: 0.6, cosine: 1, sine: 0 },
  { x: 0, z: 53, halfWidth: 54, halfDepth: 0.6, cosine: 1, sine: 0 },
  { x: -53, z: 0, halfWidth: 0.6, halfDepth: 54, cosine: 1, sine: 0 },
  { x: 53, z: 0, halfWidth: 0.6, halfDepth: 54, cosine: 1, sine: 0 },
]
/** The longest step between checks, under the thinnest solid's half thickness plus the player's radius. */
const LONGEST_STEP = 0.2

/** The objects' solid footprints, from the same layouts their meshes are drawn from, without the town's fence. */
export function getObjectCollision(objects: TownObject[]): TownCollision {
  const colliders = groupByKind(objects, (kind) => kind.colliders).map((group) => group.shared(group.objects))
  return {
    boxes: colliders.flatMap(({ boxes = [] }) => boxes),
    circles: colliders.flatMap(({ circles = [] }) => circles),
  }
}

/** The town's solid footprints, its fence, and `venueSolids`, what the shown venues build inside it. Build it once. */
export function createTownCollision(
  objects: TownObject[],
  venueSolids: TownCollision = { boxes: [], circles: [] },
): TownCollision {
  const solids = getObjectCollision(objects)
  return {
    boxes: [...TOWN_WALLS, ...solids.boxes, ...venueSolids.boxes],
    circles: [...solids.circles, ...venueSolids.circles],
  }
}

export function distanceToSegment(point: PlanarPoint, start: PlanarPoint, end: PlanarPoint) {
  const segmentX = end.x - start.x
  const segmentZ = end.z - start.z
  const lengthSquared = segmentX ** 2 + segmentZ ** 2
  const projection = ((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / (lengthSquared || 1)
  const along = clamp(projection, 0, 1)
  return Math.hypot(start.x + segmentX * along - point.x, start.z + segmentZ * along - point.z)
}

/** The point in the box's own frame, where its sides run along the axes. */
export function toBoxFrame(point: PlanarPoint, box: CollisionBox): PlanarPoint {
  const offsetX = point.x - box.x
  const offsetZ = point.z - box.z
  return { x: offsetX * box.cosine - offsetZ * box.sine, z: offsetX * box.sine + offsetZ * box.cosine }
}

/** The part of a segment, as fractions of its length, that lies within `half` of zero along one axis. */
export function getSlabSpan(start: number, change: number, half: number): [number, number] {
  if (change === 0) return Math.abs(start) <= half ? [-Infinity, Infinity] : [Infinity, -Infinity]
  const first = (-half - start) / change
  const second = (half - start) / change
  return [Math.min(first, second), Math.max(first, second)]
}

/** Whether the segment, given in the box's frame, passes through the box itself. */
export function segmentEntersBox(start: PlanarPoint, end: PlanarPoint, box: CollisionBox) {
  const [enterX, leaveX] = getSlabSpan(start.x, end.x - start.x, box.halfWidth)
  const [enterZ, leaveZ] = getSlabSpan(start.z, end.z - start.z, box.halfDepth)
  return Math.max(enterX, enterZ, 0) <= Math.min(leaveX, leaveZ, 1)
}

export function distanceToBox(localPoint: PlanarPoint, box: CollisionBox) {
  return Math.hypot(
    localPoint.x - clamp(localPoint.x, -box.halfWidth, box.halfWidth),
    localPoint.z - clamp(localPoint.z, -box.halfDepth, box.halfDepth),
  )
}

/**
 * Whether something of radius `clearance` walking straight from `start` to `end` would touch the box. Apart from
 * passing through it, the closest approach is from an end of the walk to the box or from a corner to the walk.
 */
export function segmentTouchesBox(start: PlanarPoint, end: PlanarPoint, box: CollisionBox, clearance: number) {
  const localStart = toBoxFrame(start, box)
  const localEnd = toBoxFrame(end, box)
  if (segmentEntersBox(localStart, localEnd, box)) return true
  const corners = [-1, 1].flatMap((sideX) =>
    [-1, 1].map((sideZ) => ({ x: sideX * box.halfWidth, z: sideZ * box.halfDepth })),
  )
  const closest = Math.min(
    distanceToBox(localStart, box),
    distanceToBox(localEnd, box),
    ...corners.map((corner) => distanceToSegment(corner, localStart, localEnd)),
  )
  return closest < clearance
}

export function segmentTouchesCircle(start: PlanarPoint, end: PlanarPoint, circle: CollisionCircle, clearance: number) {
  return distanceToSegment(circle, start, end) < circle.radius + clearance
}

/** Whether something of radius `clearance` walking straight from `start` to `end` would touch anything solid. */
export function segmentTouchesTown(start: PlanarPoint, end: PlanarPoint, town: TownCollision, clearance: number) {
  return (
    town.boxes.some((box) => segmentTouchesBox(start, end, box, clearance)) ||
    town.circles.some((circle) => segmentTouchesCircle(start, end, circle, clearance))
  )
}

/** Pushes the point `depth` along the unit normal and takes away whatever velocity pointed into the surface. */
export function slideOff(
  position: PlanarPoint,
  velocity: PlanarPoint,
  normalX: number,
  normalZ: number,
  depth: number,
) {
  position.x += normalX * depth
  position.z += normalZ * depth
  const inward = Math.min(0, velocity.x * normalX + velocity.z * normalZ)
  velocity.x -= normalX * inward
  velocity.z -= normalZ * inward
}

export function collideWithCircle(position: PlanarPoint, velocity: PlanarPoint, center: PlanarPoint, radius: number) {
  const offsetX = position.x - center.x
  const offsetZ = position.z - center.z
  const distance = Math.hypot(offsetX, offsetZ)
  const reach = radius + PLAYER_RADIUS
  if (distance >= reach) return
  // Exactly on the center every way out is as short, so take any.
  if (distance === 0) return slideOff(position, velocity, 1, 0, reach)
  slideOff(position, velocity, offsetX / distance, offsetZ / distance, reach - distance)
}

/** Slides off a box along a normal given in the box's own frame. */
export function slideOffBox(
  position: PlanarPoint,
  velocity: PlanarPoint,
  box: CollisionBox,
  localNormalX: number,
  localNormalZ: number,
  depth: number,
) {
  const normalX = localNormalX * box.cosine + localNormalZ * box.sine
  const normalZ = localNormalZ * box.cosine - localNormalX * box.sine
  slideOff(position, velocity, normalX, normalZ, depth)
}

/** A center already inside the box leaves through the nearest face. */
export function leaveBoxThroughNearestFace(
  position: PlanarPoint,
  velocity: PlanarPoint,
  box: CollisionBox,
  localX: number,
  localZ: number,
) {
  const throughX = box.halfWidth - Math.abs(localX)
  const throughZ = box.halfDepth - Math.abs(localZ)
  if (throughX < throughZ)
    return slideOffBox(position, velocity, box, Math.sign(localX) || 1, 0, throughX + PLAYER_RADIUS)
  slideOffBox(position, velocity, box, 0, Math.sign(localZ) || 1, throughZ + PLAYER_RADIUS)
}

export function collideWithBox(position: PlanarPoint, velocity: PlanarPoint, box: CollisionBox) {
  const offsetX = position.x - box.x
  const offsetZ = position.z - box.z
  const localX = offsetX * box.cosine - offsetZ * box.sine
  const localZ = offsetX * box.sine + offsetZ * box.cosine
  const outsideX = localX - clamp(localX, -box.halfWidth, box.halfWidth)
  const outsideZ = localZ - clamp(localZ, -box.halfDepth, box.halfDepth)
  const outside = Math.hypot(outsideX, outsideZ)
  if (outside >= PLAYER_RADIUS) return
  if (outside === 0) return leaveBoxThroughNearestFace(position, velocity, box, localX, localZ)
  slideOffBox(position, velocity, box, outsideX / outside, outsideZ / outside, PLAYER_RADIUS - outside)
}

export function stepThroughTown(
  town: TownCollision,
  actors: readonly CollisionActor[],
  position: PlanarPoint,
  velocity: PlanarPoint,
  seconds: number,
) {
  position.x += velocity.x * seconds
  position.z += velocity.z * seconds
  for (const box of town.boxes) collideWithBox(position, velocity, box)
  for (const circle of town.circles) collideWithCircle(position, velocity, circle, circle.radius)
  for (const actor of actors) collideWithCircle(position, velocity, actor.position, actor.radius)
}

/**
 * Moves the player's ground point by `velocity` over `seconds`, pushing it out of anything solid and sliding along it.
 * Both are updated in place: afterwards `velocity` has lost whatever pointed into a wall or actor, so a skid into a wall
 * stops there instead of sliding on in place. Fast frames move in short steps so nothing thin is skipped.
 */
export function moveThroughTown(
  town: TownCollision,
  actors: readonly CollisionActor[],
  position: PlanarPoint,
  velocity: PlanarPoint,
  seconds: number,
) {
  const steps = Math.max(1, Math.ceil((Math.hypot(velocity.x, velocity.z) * seconds) / LONGEST_STEP))
  for (let step = 0; step < steps; step += 1) stepThroughTown(town, actors, position, velocity, seconds / steps)
}
