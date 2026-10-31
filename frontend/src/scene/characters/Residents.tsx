import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Group, type Vector3 } from 'three'
import type { TownPoint } from '../../data/models'
import { Character, type CharacterAnimation } from './Characters'
import {
  canActorOccupyPosition,
  createAmbientConversation,
  createResidentMotion,
  getConversationTarget,
  getHeadYawToward,
  getResidentSkyGazeTilt,
  RESIDENT_WALK_SPEED,
  stepGreetingBounce,
  stepResidentMotion,
  stopBlockedMotion,
  turnResidentToward,
  updateNameTag,
} from '../motion/npcMotion'
import type { AmbientConversation, GreetingBounce, ResidentSpec, RoundObstacle, WorldActor } from '../motion/npcMotion'
import type { GaitStyle } from '../motion/gait'
import type { BenchSeat } from '../motion/characterPose'
import { Corgi } from '../animals/Corgi'
import { damp } from '../../motionMath'
import { placeCurvedLabel, WORLD_LABEL_LAYERS } from '../worldLabels'
import { languageCopy, type AppLanguage } from '../../i18n/language'

const HEAD_TURN_RATE = 6

export function WanderingResident({
  spec,
  name,
  ownerTag,
  actor,
  seat,
  occupiedSeat,
  actors,
  playerPosition,
  conversation,
  gazePhase,
  obstacles,
  reducedMotion,
  gaitStyle,
}: {
  spec: ResidentSpec
  /** The name on the tag; the town owner's resident shows the owner's name in the visitor's language. */
  name: string
  /** The small "town owner" mark beside the owner's name; `null` for everyone else. */
  ownerTag: string | null
  actor: WorldActor
  seat: BenchSeat
  occupiedSeat: MutableRefObject<string | null>
  actors: MutableRefObject<WorldActor[]>
  playerPosition: MutableRefObject<Vector3>
  conversation: AmbientConversation | null
  gazePhase: number
  obstacles: RoundObstacle[]
  reducedMotion: boolean
  gaitStyle: GaitStyle
}) {
  const group = useRef<Group>(null)
  const animationRef = useRef<CharacterAnimation>(spec.startSeated ? 'sit' : 'idle')
  const [initialMotion] = useState(() => createResidentMotion(spec, seat))
  const state = useRef({ ...initialMotion })
  const nextState = useRef({ ...initialMotion })
  const actorRef = useRef(actor)
  const speedRef = useRef(0)
  const headTiltRef = useRef(0)
  const headYawRef = useRef(0)
  const stretchRef = useRef(1)
  const bounce = useRef<GreetingBounce>({ active: false, startedAt: -Infinity })
  const talkingRef = useRef(false)
  const nameTag = useRef<HTMLDivElement>(null)
  const ambientMessage = conversation?.messages.find((message) => message.actorId === actor.id)
  const conversationPartnerId = conversation?.messages.find((message) => message.actorId !== actor.id)?.actorId

  useFrame(({ clock }, rawDelta) => {
    const node = group.current
    if (!node) return
    const now = performance.now()
    talkingRef.current = Boolean(ambientMessage) || actor.interactionUntil > now
    const skyGazeTilt = getResidentSkyGazeTilt(
      clock.elapsedTime,
      gazePhase,
      !ambientMessage && actor.interactionUntil <= now && state.current.animation !== 'sit',
    )
    const random = Math.random()
    let next = stepResidentMotion(
      state.current,
      spec,
      seat,
      clock.elapsedTime,
      rawDelta,
      actor.interactionUntil > now || skyGazeTilt < 0,
      occupiedSeat.current === seat.id,
      random,
      nextState.current,
    )
    const moving = next.animation === 'walk'
    const free =
      !moving || canActorOccupyPosition(actor, next.x, next.z, actors.current, playerPosition.current, obstacles)
    if (!free) next = stopBlockedMotion(state.current, next, clock.elapsedTime, spec.route.length, random)
    const partner = actors.current.find((candidate) => candidate.id === conversationPartnerId)
    const conversationTarget = getConversationTarget(
      Boolean(ambientMessage),
      partner,
      actor.interactionUntil > now,
      playerPosition.current,
    )
    if (conversationTarget)
      next.rotation = turnResidentToward(
        next.rotation,
        next.x,
        next.z,
        conversationTarget.x,
        conversationTarget.z,
        rawDelta,
      )
    nextState.current = state.current
    state.current = next
    node.position.set(next.x, next.y, next.z)
    node.rotation.y = next.rotation
    animationRef.current = next.animation
    speedRef.current = next.speed
    headTiltRef.current = skyGazeTilt
    const player = playerPosition.current
    const lookYaw = ambientMessage ? 0 : getHeadYawToward(next.x, next.z, next.rotation, player.x, player.z)
    const headTurnRate = reducedMotion ? HEAD_TURN_RATE / 2 : HEAD_TURN_RATE
    headYawRef.current = damp(headYawRef.current, lookYaw, headTurnRate, Math.min(rawDelta, 0.05))
    stretchRef.current = stepGreetingBounce(bounce.current, talkingRef.current, clock.elapsedTime, reducedMotion)
    actorRef.current.seatId = next.animation === 'sit' ? seat.id : undefined
    actor.position.set(node.position.x, 1.2, node.position.z)
    updateNameTag(nameTag.current, actor.position, playerPosition.current)
  }, -3)

  return (
    <group
      ref={group}
      position={[initialMotion.x, initialMotion.y, initialMotion.z]}
      rotation={[0, initialMotion.rotation, 0]}
    >
      <Character
        animationRef={animationRef}
        speedRef={speedRef}
        headTiltRef={headTiltRef}
        headYawRef={headYawRef}
        stretchRef={stretchRef}
        walkSpeed={RESIDENT_WALK_SPEED}
        gaitStyle={gaitStyle}
        profile={spec.profile}
        talkingRef={talkingRef}
        expressionPhase={gazePhase}
        blinkSeed={gazePhase + 1}
      />
      {!ambientMessage && (
        <Html
          center
          calculatePosition={placeCurvedLabel}
          position={[0, 2.05, 0]}
          distanceFactor={12}
          zIndexRange={WORLD_LABEL_LAYERS}
          style={{ pointerEvents: 'none' }}
        >
          <div ref={nameTag} className="character-name proximity-name">
            {name}
            {ownerTag && <span> {ownerTag}</span>}
          </div>
        </Html>
      )}
      {ambientMessage && (
        <Html
          center
          calculatePosition={placeCurvedLabel}
          position={[0, 2.05, 0]}
          distanceFactor={12}
          zIndexRange={WORLD_LABEL_LAYERS}
          style={{ pointerEvents: 'none' }}
        >
          <div className="ambient-speech">{ambientMessage.text}</div>
        </Html>
      )}
    </group>
  )
}

export const Residents = memo(function Residents({
  residentSpecs,
  actors,
  seats,
  occupiedSeat,
  playerPosition,
  reducedMotion,
  obstacles,
  gaitStyle,
  language,
  petName,
  petRoute,
  ownerName,
  ownerResidentId,
}: {
  residentSpecs: ResidentSpec[]
  actors: MutableRefObject<WorldActor[]>
  seats: BenchSeat[]
  occupiedSeat: MutableRefObject<string | null>
  playerPosition: MutableRefObject<Vector3>
  reducedMotion: boolean
  obstacles: RoundObstacle[]
  gaitStyle: GaitStyle
  language: AppLanguage
  /** The town's pet name in `language`. */
  petName: string
  petRoute: readonly TownPoint[]
  /** The town owner's name in `language`, shown on the tag of the resident who is the owner. */
  ownerName: string
  ownerResidentId: string | null
}) {
  const copy = languageCopy[language]
  const ambientLines = copy.ambientChats(petName)
  const [conversation, setConversation] = useState<(AmbientConversation & { endsAt: number }) | null>(null)
  const conversationRef = useRef<(AmbientConversation & { endsAt: number }) | null>(null)
  const nextConversationAt = useRef(6)

  useFrame(({ clock }) => {
    const elapsed = clock.elapsedTime
    const active = conversationRef.current
    if (active && elapsed >= active.endsAt) {
      conversationRef.current = null
      setConversation(null)
      return
    }
    if (active || elapsed < nextConversationAt.current) return
    const next = createAmbientConversation(actors.current, Math.random(), performance.now(), ambientLines)
    if (!next) {
      nextConversationAt.current = elapsed + 0.5
      return
    }
    const durationSeconds = 4.6
    const started = { ...next, endsAt: elapsed + durationSeconds }
    const participantIds = next.messages.map((message) => message.actorId)
    actors.current
      .filter((actor) => participantIds.includes(actor.id))
      .forEach((actor) => {
        actor.interactionUntil = performance.now() + durationSeconds * 1000
      })
    conversationRef.current = started
    setConversation(started)
    nextConversationAt.current = started.endsAt + 8 + Math.random() * 10
  }, -4)

  return (
    <>
      {residentSpecs.map((spec, index) => (
        <WanderingResident
          key={spec.id}
          spec={spec}
          name={spec.id === ownerResidentId ? ownerName : spec.name}
          ownerTag={spec.id === ownerResidentId ? copy.residentDialogue.ownerTag : null}
          actor={actors.current[index]}
          seat={seats.find((seat) => seat.id === spec.benchId)!}
          occupiedSeat={occupiedSeat}
          actors={actors}
          playerPosition={playerPosition}
          conversation={conversation}
          gazePhase={index * 7.3}
          obstacles={obstacles}
          reducedMotion={reducedMotion}
          gaitStyle={gaitStyle}
        />
      ))}
      <Corgi
        actor={actors.current[residentSpecs.length]}
        name={petName}
        breed={copy.pet.breed}
        route={petRoute}
        playerPosition={playerPosition}
        actors={actors}
        reducedMotion={reducedMotion}
        obstacles={obstacles}
      />
    </>
  )
})
