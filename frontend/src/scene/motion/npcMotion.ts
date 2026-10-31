import { Vector3 } from 'three'
import type { TownResident } from '../../data/models'
import type { PlayerProfile } from '../../data/playerProfile'
import { clamp, damp, dampAngle, wrapAngle } from '../../motionMath'
import { getBenchPose, type BenchSeat } from './characterPose'
import type { CharacterAnimation } from '../characters/Characters'

export type WorldActor = {
  id: string
  name: string
  kind: 'resident' | 'dog'
  avatar: string
  position: Vector3
  radius: number
  interactionUntil: number
  pettingUntil: number
  seatId?: string
}

export type ResidentSpec = WorldActor & {
  route: ReadonlyArray<readonly [number, number]>
  seatIndex: number
  benchId: string
  startSeated?: boolean
  profile: PlayerProfile
}

/** A round solid that walking actors steer around, such as the fountain basin. */
export type RoundObstacle = { x: number; z: number; radius: number }

export type AmbientConversation = {
  messages: [{ actorId: string; text: string }, { actorId: string; text: string }]
}

export const RESIDENT_WALK_SPEED = 2.2

const SKY_GAZE_CYCLE_SECONDS = 30
const SKY_GAZE_START_SECONDS = 20
const SKY_GAZE_TRANSITION_SECONDS = 0.6
const SKY_GAZE_HOLD_SECONDS = 5
const SKY_GAZE_TILT = -0.62
const HEAD_TURN_RANGE = 4
const HEAD_TURN_LIMIT = 0.7
// Past this the head cannot reach, and the clamped turn would flip sides as someone crosses behind.
const HEAD_TURN_BEHIND = 2.3
const GREETING_BOUNCE_SECONDS = 0.6
const NAME_TAG_DISTANCE_SQUARED = 6 ** 2

/** The head's yaw relative to the body to look at someone within a few metres; 0 when they are far or behind. */
export function getHeadYawToward(x: number, z: number, bodyRotation: number, targetX: number, targetZ: number) {
  const differenceX = targetX - x
  const differenceZ = targetZ - z
  if (differenceX ** 2 + differenceZ ** 2 > HEAD_TURN_RANGE ** 2) return 0
  const relativeTurn = wrapAngle(Math.atan2(differenceX, differenceZ) - bodyRotation)
  if (Math.abs(relativeTurn) > HEAD_TURN_BEHIND) return 0
  return clamp(relativeTurn, -HEAD_TURN_LIMIT, HEAD_TURN_LIMIT)
}

/** Vertical scale for the little hop as a conversation starts: a squash, a stretch, then rest. */
export function getGreetingStretch(sinceStart: number) {
  if (sinceStart < 0 || sinceStart >= GREETING_BOUNCE_SECONDS) return 1
  return 1 - Math.sin(sinceStart * 16) * 0.07 * (1 - sinceStart / GREETING_BOUNCE_SECONDS)
}

export type GreetingBounce = { active: boolean; startedAt: number }

/** Vertical scale for the hop a character gives as a conversation or greeting starts; none with reduced motion. */
export function stepGreetingBounce(bounce: GreetingBounce, active: boolean, elapsed: number, reducedMotion: boolean) {
  if (active && !bounce.active) bounce.startedAt = elapsed
  bounce.active = active
  if (reducedMotion) return 1
  return getGreetingStretch(elapsed - bounce.startedAt)
}

/** Shows an actor's name tag only while the player is near enough to read it. */
export function updateNameTag(element: HTMLDivElement | null, actorPosition: Vector3, playerPosition: Vector3) {
  if (!element) return
  element.classList.toggle('is-visible', actorPosition.distanceToSquared(playerPosition) <= NAME_TAG_DISTANCE_SQUARED)
}

export function getResidentSkyGazeTilt(elapsed: number, phase: number, enabled: boolean) {
  if (!enabled) return 0
  const gazeTime = (elapsed + phase) % SKY_GAZE_CYCLE_SECONDS
  const gazeElapsed = gazeTime - SKY_GAZE_START_SECONDS
  const gazeEnd = SKY_GAZE_TRANSITION_SECONDS * 2 + SKY_GAZE_HOLD_SECONDS
  if (gazeElapsed < 0 || gazeElapsed > gazeEnd) return 0
  if (gazeElapsed < SKY_GAZE_TRANSITION_SECONDS) return SKY_GAZE_TILT * (gazeElapsed / SKY_GAZE_TRANSITION_SECONDS)
  if (gazeElapsed <= SKY_GAZE_TRANSITION_SECONDS + SKY_GAZE_HOLD_SECONDS) return SKY_GAZE_TILT
  return SKY_GAZE_TILT * ((gazeEnd - gazeElapsed) / SKY_GAZE_TRANSITION_SECONDS)
}

export function createResidentSpecs(residents: TownResident[]): ResidentSpec[] {
  return residents.map((resident) => ({
    ...resident,
    kind: 'resident',
    avatar: Array.from(resident.name)[0] ?? '?',
    position: new Vector3(resident.route[0][0], 1.2, resident.route[0][1]),
    radius: 0.48,
    interactionUntil: 0,
    pettingUntil: 0,
  }))
}

/** How far the pet's body reaches from its center, as the town keeps it apart from people and the fountain. */
export const PET_BODY_RADIUS = 0.82

// The pet is shown by the town's pet name in the visitor's language, so the actor itself carries none.
const petSpec: WorldActor = {
  id: 'pet',
  name: '',
  kind: 'dog',
  avatar: '🐾',
  position: new Vector3(-4, 0.7, 0),
  radius: PET_BODY_RADIUS,
  interactionUntil: 0,
  pettingUntil: 0,
}

export function createWorldActors(residentSpecs: ResidentSpec[]) {
  const residents = residentSpecs.map(({ id, name, kind, avatar, position, radius }) => ({
    id,
    name,
    kind,
    avatar,
    position: position.clone(),
    radius,
    interactionUntil: 0,
    pettingUntil: 0,
  }))
  return [...residents, { ...petSpec, position: petSpec.position.clone() }]
}

/** `lines` are the pairs of curated lines, in the visitor's language, that two nearby residents may exchange. */
export function createAmbientConversation(
  actors: WorldActor[],
  random: number,
  nowMilliseconds: number,
  lines: ReadonlyArray<readonly [string, string]>,
  maximumDistance = 3.4,
): AmbientConversation | null {
  const residents = actors.filter((actor) => actor.kind === 'resident')
  const pairs = residents.flatMap((resident, index) =>
    residents.slice(index + 1).map((other) => [resident, other] as const),
  )
  const available = pairs.filter(
    ([first, second]) =>
      !first.seatId &&
      !second.seatId &&
      first.interactionUntil <= nowMilliseconds &&
      second.interactionUntil <= nowMilliseconds &&
      first.position.distanceToSquared(second.position) <= maximumDistance ** 2,
  )
  if (available.length === 0) return null
  const selection = Math.min(available.length - 1, Math.floor(Math.max(0, random) * available.length))
  const [first, second] = available[selection]
  const [firstLine, secondLine] = lines[selection % lines.length]
  return {
    messages: [
      { actorId: first.id, text: firstLine },
      { actorId: second.id, text: secondLine },
    ],
  }
}

export function nextRouteIndex(current: number, length: number, random = Math.random()) {
  if (length < 2) return 0
  return (current + (random < 0.5 ? -1 : 1) + length) % length
}

export type ResidentMotion = {
  x: number
  y: number
  z: number
  rotation: number
  routeIndex: number
  waitUntil: number
  seatedUntil: number
  speed: number
  animation: CharacterAnimation
}

export function createResidentMotion(spec: ResidentSpec, seat: BenchSeat): ResidentMotion {
  const [x, z] = spec.route[0]
  const initial = {
    x,
    y: 0.88,
    z,
    rotation: 0,
    routeIndex: 1,
    waitUntil: 0,
    seatedUntil: 0,
    speed: 0,
    animation: 'idle' as const,
  }
  if (!spec.startSeated && spec.seatIndex === 0) return { ...initial, ...getBenchPose(seat, false) }
  if (!spec.startSeated) return initial
  return {
    ...initial,
    ...getBenchPose(seat, true),
    routeIndex: nextRouteIndex(spec.seatIndex, spec.route.length, 0.9),
    seatedUntil: 8,
    animation: 'sit',
  }
}

export function stepResidentMotion(
  current: ResidentMotion,
  spec: ResidentSpec,
  seat: BenchSeat,
  elapsed: number,
  delta: number,
  interacting: boolean,
  seatOccupied: boolean,
  random: number,
  result: ResidentMotion = { ...current },
): ResidentMotion {
  Object.assign(result, current)
  if (current.seatedUntil > elapsed) return result
  if (current.animation === 'sit') {
    Object.assign(result, getBenchPose(seat, false))
    result.animation = 'idle'
    result.speed = 0
    result.waitUntil = elapsed + 0.2
    return result
  }
  if (interacting || current.waitUntil > elapsed) {
    result.animation = 'idle'
    result.speed = 0
    return result
  }
  const [routeX, routeZ] = spec.route[current.routeIndex]
  const approachingSeat = current.routeIndex === spec.seatIndex
  const targetX = approachingSeat ? seat.x + Math.sin(seat.rotation) * 1.35 : routeX
  const targetZ = approachingSeat ? seat.z + Math.cos(seat.rotation) * 1.35 : routeZ
  const differenceX = targetX - current.x
  const differenceZ = targetZ - current.z
  const distance = Math.hypot(differenceX, differenceZ)
  if (distance > 0.15) {
    const frame = clamp(delta, 0, 0.05)
    const targetSpeed = clamp(distance * 2.4, 0.55, RESIDENT_WALK_SPEED)
    result.speed = damp(current.speed, targetSpeed, 8, frame)
    const step = Math.min(distance, result.speed * frame)
    result.x += (differenceX / distance) * step
    result.z += (differenceZ / distance) * step
    result.rotation = dampAngle(current.rotation, Math.atan2(differenceX, differenceZ), 10, delta)
    result.animation = 'walk'
    return result
  }
  result.routeIndex = nextRouteIndex(current.routeIndex, spec.route.length, random)
  if (current.routeIndex === spec.seatIndex && !seatOccupied && random < 0.48) {
    Object.assign(result, getBenchPose(seat, true))
    result.seatedUntil = elapsed + 5 + random * 8
    result.animation = 'sit'
    result.speed = 0
    return result
  }
  result.x = targetX
  result.z = targetZ
  result.waitUntil = elapsed + 0.8 + random * 2.5
  result.speed = 0
  result.animation = 'idle'
  return result
}

export function canActorOccupyPosition(
  actor: WorldActor,
  x: number,
  z: number,
  actors: WorldActor[],
  playerPosition: Vector3,
  obstacles: RoundObstacle[],
) {
  if (obstacles.some((obstacle) => Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + actor.radius))
    return false
  const playerClearance = actor.radius + 0.52
  if (Math.hypot(x - playerPosition.x, z - playerPosition.z) < playerClearance) return false
  return actors
    .filter((candidate) => candidate.id !== actor.id)
    .every(
      (candidate) => Math.hypot(x - candidate.position.x, z - candidate.position.z) >= actor.radius + candidate.radius,
    )
}

export function stopBlockedMotion(
  current: ResidentMotion,
  result: ResidentMotion,
  elapsed: number,
  routeLength: number,
  random = Math.random(),
) {
  result.x = current.x
  result.z = current.z
  result.rotation = current.rotation
  result.routeIndex = nextRouteIndex(current.routeIndex, routeLength, random)
  result.speed = 0
  result.animation = 'idle'
  result.waitUntil = elapsed + 0.35 + random * 0.5
  return result
}

export function turnResidentToward(
  currentRotation: number,
  residentX: number,
  residentZ: number,
  targetX: number,
  targetZ: number,
  delta: number,
) {
  const desiredRotation = Math.atan2(targetX - residentX, targetZ - residentZ)
  return dampAngle(currentRotation, desiredRotation, 10, clamp(delta, 0, 0.05))
}

/** Whom a resident turns to face: the partner of an ambient chat, or the player while talking with them. */
export function getConversationTarget(
  chatting: boolean,
  partner: WorldActor | undefined,
  talkingToPlayer: boolean,
  playerPosition: Vector3,
) {
  if (chatting) return partner?.position ?? null
  return talkingToPlayer ? playerPosition : null
}

export function isActorConversationInRange(
  actorId: string | null,
  playerPosition: Vector3,
  actors: WorldActor[],
  maximumDistance = 3.4,
) {
  if (!actorId) return true
  const actor = actors.find((candidate) => candidate.id === actorId)
  return Boolean(actor && actor.position.distanceToSquared(playerPosition) <= maximumDistance ** 2)
}
