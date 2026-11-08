import { Html, useKeyboardControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Group, Vector3 } from 'three'
import type { TownGuideStep, TownObject, Vec3 } from '../../data/models'
import type { PlayerProfile } from '../../data/playerProfile'
import { firstOwnerQuestions, firstResidentQuestions } from '../../data/residentDialogue'
import type { TownGuideEvent } from '../../data/townGuide'
import type { AppLanguage } from '../../i18n/language'
import { languageCopy } from '../../i18n/language'
import { Character, type CharacterAnimation } from './Characters'
import {
  framedStatue,
  getNearbyInteraction,
  isSameInteraction,
  type Interaction,
  type InteractionRequest,
  type DialogueMessage,
  type StatueSpot,
} from '../playerInteraction'
import type { Control } from '../controls'
import { movementHoldDuration, shouldSprint } from '../controls'
import {
  getGreetingStretch,
  holdConversationPartner,
  isActorConversationInRange,
  type WorldActor,
} from '../motion/npcMotion'
import { getBenchPose, getMovementAnimation, type BenchSeat } from '../motion/characterPose'
import { petResponse, type PetSound } from '../animals/petInteraction'
import { PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from '../motion/playerMotion'
import {
  createPlayerMovement,
  getSlidingShoes,
  SKID_DUST_SPACING,
  stepPlayerMovement,
  type MovementEvent,
  type PlayerMovement,
  type SkidStyle,
} from '../motion/skidTurn'
import type { GaitStyle } from '../motion/gait'
import { createDustCloud, puffDust, puffFootfallDust } from '../motion/dustCloud'
import { SkidDust } from '../motion/SkidDust'
import { SkidMarks } from '../motion/SkidMarks'
import { addSkidMark, createSkidMarkTrail } from '../motion/skidMarkTrail'
import type { GroundSurface } from '../environment/groundSurface'
import { seasonClock } from '../environment/seasonTransition'
import type { SkidSound, SquealLength } from '../../audio/skidSqueal'
import { TownGuide } from '../../ui/TownGuide'
import { clamp, dampAngle, dampingAlpha } from '../../motionMath'
import { moveThroughTown, type TownCollision } from '../townCollision'
import { placeCurvedLabel } from '../worldLabels'
import type { VenueEntrance } from '../venues/venuePlacements'

type Props = {
  profile: PlayerProfile
  controlsEnabled: boolean
  spawn: Vec3
  resetKey: number
  playerPosition: MutableRefObject<Vector3>
  movementDirection: MutableRefObject<Vector3>
  touchMovement: MutableRefObject<{ x: number; y: number }>
  actors: MutableRefObject<WorldActor[]>
  collision: TownCollision
  seats: BenchSeat[]
  houses: TownObject[]
  guestbookPosition: Vec3 | null
  /** The gates of the venues the admin shows; empty while every venue is hidden. */
  venueEntrances: VenueEntrance[]
  /** Where the shown venues' statue cards open; empty while every venue is hidden. */
  statueSpots: StatueSpot[]
  occupiedSeatRef: MutableRefObject<string | null>
  interactionRequest: InteractionRequest
  onInteractionChange: (interaction: Interaction | null) => void
  onDialogue: (message: DialogueMessage | null) => void
  /** The resident whose conversation is open in the dialogue box, held in place until it closes. */
  talkingWith: string | null
  onPetSound: (sound: PetSound) => void
  /** `intensity` grows with the running speed the skid started from. */
  onSkid: (sound: SkidSound, intensity: number, length: SquealLength) => void
  /** How the player skids when turning back at a run, chosen by the admin for the town. */
  skidStyle: SkidStyle
  gaitStyle: GaitStyle
  onFootstep: (x: number, z: number, running: boolean) => void
  /** What the ground is at a point, so skids leave marks on paths and snow but not on grass. */
  surfaceAt: (x: number, z: number) => GroundSurface
  /**
   * Where the camera should frame a conversation: the actor talking with the player, or else the statue the player
   * stopped to read, if any.
   */
  dialogueFocusRef: MutableRefObject<Vector3 | null>
  onGuideEvent: (event: TownGuideEvent) => void
  guideStep: TownGuideStep
  language: AppLanguage
  /** The town owner's and pet's names in `language`. */
  ownerName: string
  petName: string
  /** The resident who is the town owner, greeted with the owner's questions instead of a resident's. */
  ownerResidentId: string | null
  onGuestbookOpen: () => void
  onHouseUnavailable: () => void
  /** Leaves the town for a venue's page through its gate. */
  onVenueEnter: (href: string) => void
  /** Drops the hop as an interaction starts and the dust kicked up by running. */
  reducedMotion: boolean
}

const cameraForward = new Vector3()
const cameraRight = new Vector3()
const wantedDirection = new Vector3()
// How far below the body's center the feet touch the ground.
const FEET_BELOW_CENTER = 0.87
// A stalled frame, like a hidden tab's, is caught up on only this far instead of in one long stride.
const LONGEST_MOVE_SECONDS = 0.5
const attachedGuideSteps = new Set<TownGuideStep>([
  'move',
  'glance',
  'view',
  'bench',
  'photo',
  'appearance',
  'environment',
  'pet',
  'resident',
  'guestbook',
])

export function Player({
  profile,
  controlsEnabled,
  spawn,
  resetKey,
  playerPosition,
  movementDirection,
  touchMovement,
  actors,
  collision,
  seats,
  houses,
  guestbookPosition,
  venueEntrances,
  statueSpots,
  occupiedSeatRef,
  interactionRequest,
  onInteractionChange,
  onDialogue,
  talkingWith,
  onPetSound,
  onSkid,
  skidStyle,
  gaitStyle,
  onFootstep,
  surfaceAt,
  dialogueFocusRef,
  onGuideEvent,
  guideStep,
  language,
  ownerName,
  petName,
  ownerResidentId,
  onGuestbookOpen,
  onHouseUnavailable,
  onVenueEnter,
  reducedMotion,
}: Props) {
  const body = useRef(new Vector3(spawn.x, FEET_BELOW_CENTER, spawn.z))
  const model = useRef<Group>(null)
  const camera = useThree((state) => state.camera)
  const [, getKeys] = useKeyboardControls<Control>()
  const animationRef = useRef<CharacterAnimation>('idle')
  const speedRef = useRef(0)
  const interactionRef = useRef<Interaction | null>(null)
  const sittingSeat = useRef<BenchSeat | null>(null)
  const heldSeconds = useRef(0)
  // How long the player has stood still, so the camera frames a statue only once they stop to read it.
  const stillSeconds = useRef(0)
  const statueFocus = useRef(new Vector3())
  // The body's ground velocity after its last move, less whatever walls and actors took away.
  const velocity = useRef({ x: 0, z: 0 })
  const movement = useRef(createPlayerMovement())
  const dust = useRef(createDustCloud())
  const slidSinceDust = useRef(0)
  const footfalls = useRef(0)
  const skidMarks = useRef(createSkidMarkTrail())
  const heardFootfalls = useRef(0)
  const standPrompt = useRef<Interaction>({ id: 'standing', kind: 'bench', label: 'Stand up' })
  const dialogueActorId = useRef<string | null>(null)
  const pettingRef = useRef(false)
  const reportedMovement = useRef(false)
  const onDialogueRef = useRef(onDialogue)
  const stretchRef = useRef(1)
  // performance.now() when the player last started talking, petting, or sitting, for the same hop residents give.
  const interactionStartedAt = useRef(-Infinity)

  // Guide callbacks change between lessons; only spawn/reset changes may move the player.
  useEffect(() => {
    onDialogueRef.current = onDialogue
  }, [onDialogue])

  const updateInteraction = (interaction: Interaction | null) => {
    if (isSameInteraction(interactionRef.current, interaction)) return
    interactionRef.current = interaction
    onInteractionChange(interaction)
  }

  const halt = () => {
    velocity.current.x = 0
    velocity.current.z = 0
  }

  /** Draws the body where it is and reports that as the player's position. */
  const placeBody = () => {
    model.current?.position.copy(body.current)
    playerPosition.current.copy(body.current)
  }

  const ground = (position: { x: number; y: number; z: number }) => ({
    x: position.x,
    y: position.y - FEET_BELOW_CENTER,
    z: position.z,
  })

  const announceMovement = (
    event: MovementEvent,
    motion: PlayerMovement,
    feet: { x: number; y: number; z: number },
  ) => {
    if (event.type === 'launch') {
      const back = { x: -motion.wantedDirection.x, z: -motion.wantedDirection.z }
      const behind = { x: feet.x + back.x * 0.15, y: feet.y, z: feet.z + back.z * 0.15 }
      Array.from({ length: 5 }, () => puffDust(dust.current, behind, back, 1.8, 0.12))
      return
    }
    if (event.type !== 'skid' && event.type !== 'brake') return
    if (!event.quiet)
      onSkid(event.type, clamp(event.speed / PLAYER_RUN_SPEED, 0.45, 1.05), motion.style === 'short' ? 'short' : 'long')
    const ahead = { x: feet.x + motion.slideDirection.x * 0.35, y: feet.y, z: feet.z + motion.slideDirection.z * 0.35 }
    Array.from({ length: 4 }, () => puffDust(dust.current, ahead, motion.slideDirection, 1.6, 0.13))
  }

  /** Squeals and bursts of dust when a slide starts, a trail of puffs from the braced shoe while it lasts. */
  const reactToMovement = (motion: PlayerMovement, position: { x: number; y: number; z: number }, delta: number) => {
    const feet = ground(position)
    motion.events.forEach((event) => announceMovement(event, motion, feet))
    motion.events.length = 0
    const sliding = motion.mode === 'skid' || motion.mode === 'brake'
    slidSinceDust.current = sliding
      ? slidSinceDust.current + Math.hypot(motion.velocity.x, motion.velocity.z) * delta
      : 0
    if (slidSinceDust.current < SKID_DUST_SPACING) return
    slidSinceDust.current = 0
    const shoes = getSlidingShoes(feet, motion)
    puffDust(dust.current, shoes.braced, motion.slideDirection, 0.9, 0.12)
    const surface = surfaceAt(shoes.braced.x, shoes.braced.z)
    if (surface === 'grass') return
    const angle = Math.atan2(motion.slideDirection.x, motion.slideDirection.z)
    const bornAt = seasonClock()
    addSkidMark(skidMarks.current, { ...shoes.braced, angle, surface, bornAt })
    addSkidMark(skidMarks.current, { ...shoes.free, angle, surface, bornAt })
  }

  /** A little dust from each running footfall; snow takes footprints instead. */
  const kickUpDust = (position: { x: number; y: number; z: number }, running: boolean) => {
    if (!running || reducedMotion || surfaceAt(position.x, position.z) === 'snow') return
    puffFootfallDust(dust.current, ground(position), velocity.current, footfalls.current % 2 ? 1 : -1)
  }

  const answerPet = (actor: WorldActor, greeting: boolean) => {
    const response = petResponse(!greeting, petName, language)
    actor.pettingUntil = response.pettingDuration ? performance.now() + response.pettingDuration : 0
    onDialogue({ speaker: petName, text: response.text, avatar: actor.avatar, actorId: actor.id })
    onPetSound(response.sound)
    if (greeting) onGuideEvent('greeted-pet')
  }

  const stand = () => {
    const seat = sittingSeat.current
    if (!seat) return
    sittingSeat.current = null
    occupiedSeatRef.current = null
    const standing = getBenchPose(seat, false)
    body.current.set(standing.x, FEET_BELOW_CENTER, standing.z)
    halt()
    animationRef.current = 'idle'
    updateInteraction(null)
    onDialogueRef.current(null)
    dialogueActorId.current = null
    pettingRef.current = false
  }

  const sit = (seat: BenchSeat) => {
    if (actors.current.some((actor) => actor.seatId === seat.id)) return
    sittingSeat.current = seat
    occupiedSeatRef.current = seat.id
    interactionStartedAt.current = performance.now()
    const pose = getBenchPose(seat, true)
    standPrompt.current.id = seat.id
    halt()
    body.current.set(pose.x, pose.y, pose.z)
    if (model.current) model.current.rotation.y = pose.rotation
    movement.current = createPlayerMovement(pose.rotation)
    heldSeconds.current = 0
    animationRef.current = 'sit'
    onDialogue(null)
    dialogueActorId.current = null
    onGuideEvent('sat-on-bench')
  }

  useEffect(() => {
    body.current.set(spawn.x, FEET_BELOW_CENTER, spawn.z)
    velocity.current.x = 0
    velocity.current.z = 0
    playerPosition.current.copy(body.current)
    movementDirection.current.set(0, 0, 0)
    sittingSeat.current = null
    occupiedSeatRef.current = null
    heldSeconds.current = 0
    speedRef.current = 0
    movement.current = createPlayerMovement(model.current?.rotation.y ?? 0)
    dialogueActorId.current = null
    onDialogueRef.current(null)
    animationRef.current = 'idle'
  }, [movementDirection, occupiedSeatRef, playerPosition, resetKey, spawn])

  useEffect(() => {
    if (!interactionRequest || !controlsEnabled) return
    if (interactionRequest.action === 'greet' && interactionRef.current?.actorId !== 'pet') return
    if (sittingSeat.current) {
      stand()
      return
    }
    const interaction = interactionRef.current
    if (!interaction) return
    if (interaction.kind === 'guestbook') {
      onGuestbookOpen()
      return
    }
    if (interaction.kind === 'house') {
      onHouseUnavailable()
      return
    }
    if (interaction.kind === 'venue' && interaction.href) {
      onVenueEnter(interaction.href)
      return
    }
    if (interaction.kind === 'bench' && interaction.seat) {
      sit(interaction.seat)
      return
    }
    const actor = actors.current.find((candidate) => candidate.id === interaction.actorId)
    if (!actor || actor.position.distanceTo(playerPosition.current) > 2.8) return
    actor.interactionUntil = performance.now() + 5000
    interactionStartedAt.current = performance.now()
    dialogueActorId.current = actor.id
    if (actor.kind === 'dog') {
      answerPet(actor, interactionRequest.action === 'greet')
      return
    }
    const owner = actor.id === ownerResidentId
    onDialogue({
      speaker: owner ? ownerName : actor.name,
      text: languageCopy[language].residentDialogue.greeting(profile.name),
      avatar: actor.avatar,
      actorId: actor.id,
      voice: 'resident',
      choices: owner ? firstOwnerQuestions(language) : firstResidentQuestions(language, ownerName),
    })
    // interactionRequest is deliberately the button/key command signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionRequest])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const keys = getKeys()
    const now = performance.now()
    holdConversationPartner(actors.current, talkingWith, now)
    const pettingActor = actors.current.find(
      (actor) => actor.id === dialogueActorId.current && actor.kind === 'dog' && actor.pettingUntil > now,
    )
    pettingRef.current = Boolean(pettingActor)
    stretchRef.current = reducedMotion ? 1 : getGreetingStretch((now - interactionStartedAt.current) / 1000)
    if (!controlsEnabled) {
      halt()
      placeBody()
      movementDirection.current.set(0, 0, 0)
      heldSeconds.current = 0
      animationRef.current = sittingSeat.current ? 'sit' : 'idle'
      speedRef.current = 0
      movement.current = createPlayerMovement(movement.current.yaw)
      return
    }
    const horizontalInput = pettingActor ? 0 : Number(keys.right) - Number(keys.left) + touchMovement.current.x
    const verticalInput = pettingActor ? 0 : Number(keys.forward) - Number(keys.backward) + touchMovement.current.y
    if (!reportedMovement.current && Math.hypot(horizontalInput, verticalInput) >= 0.2) {
      reportedMovement.current = true
      onGuideEvent('moved')
    }

    if (sittingSeat.current && Math.abs(horizontalInput) + Math.abs(verticalInput) > 0.1) stand()
    if (sittingSeat.current) {
      speedRef.current = 0
      placeBody()
      movementDirection.current.set(0, 0, 0)
      updateInteraction(standPrompt.current)
      return
    }

    camera.getWorldDirection(cameraForward)
    cameraForward.y = 0
    if (cameraForward.lengthSq() < 0.001) cameraForward.set(0, 0, -1)
    cameraForward.normalize()
    cameraRight.crossVectors(cameraForward, camera.up).normalize()
    wantedDirection.copy(cameraForward).multiplyScalar(verticalInput).addScaledVector(cameraRight, horizontalInput)
    if (wantedDirection.lengthSq() > 1) wantedDirection.normalize()

    heldSeconds.current = movementHoldDuration(heldSeconds.current, horizontalInput, verticalInput, delta)
    const sprinting = shouldSprint(heldSeconds.current, keys.sprint)
    movement.current.style = skidStyle
    const motion = stepPlayerMovement(
      movement.current,
      wantedDirection,
      sprinting ? PLAYER_RUN_SPEED : PLAYER_WALK_SPEED,
      delta,
      velocity.current,
    )
    velocity.current.x = motion.velocity.x
    velocity.current.z = motion.velocity.z
    const moveSeconds = Math.min(rawDelta, LONGEST_MOVE_SECONDS)
    moveThroughTown(collision, actors.current, body.current, velocity.current, moveSeconds)
    speedRef.current = Math.hypot(motion.velocity.x, motion.velocity.z)
    animationRef.current = getMovementAnimation(speedRef.current)
    stillSeconds.current = speedRef.current < 0.3 ? stillSeconds.current + delta : 0

    movementDirection.current.lerp(wantedDirection, dampingAlpha(10, delta))
    if (wantedDirection.lengthSq() === 0 && movementDirection.current.lengthSq() < 0.0001)
      movementDirection.current.set(0, 0, 0)

    if (pettingActor) {
      const facing = Math.atan2(
        pettingActor.position.x - playerPosition.current.x,
        pettingActor.position.z - playerPosition.current.z,
      )
      motion.yaw = dampAngle(motion.yaw, facing, 14, delta)
    }
    if (model.current) model.current.rotation.y = motion.yaw

    placeBody()
    const position = body.current
    reactToMovement(motion, position, delta)
    const running = speedRef.current > 5
    if (footfalls.current !== heardFootfalls.current) {
      onFootstep(position.x, position.z, running)
      kickUpDust(position, running)
    }
    heardFootfalls.current = footfalls.current

    dialogueFocusRef.current = actors.current.find((actor) => actor.id === dialogueActorId.current)?.position ?? null
    if (!isActorConversationInRange(dialogueActorId.current, playerPosition.current, actors.current)) {
      dialogueActorId.current = null
      onDialogue(null)
    }

    updateInteraction(
      getNearbyInteraction(playerPosition.current, {
        actors: actors.current,
        seats,
        houses,
        guestbookPosition,
        venueEntrances,
        statueSpots,
        labels: {
          guestbook: languageCopy[language].guestbook.boardPrompt,
          house: languageCopy[language].app.tryHouseDoor,
          pet: languageCopy[language].pet.petAction(petName),
          statue: languageCopy[language].venues.ballpark.statues.sign,
        },
      }),
    )
    dialogueFocusRef.current ??= framedStatue(interactionRef.current, stillSeconds.current, statueFocus.current)
  }, -3)

  return (
    <>
      <SkidDust cloud={dust} />
      <SkidMarks trailRef={skidMarks} />
      <group ref={model}>
        <Character
          animationRef={animationRef}
          profile={profile}
          speedRef={speedRef}
          stretchRef={stretchRef}
          pettingRef={pettingRef}
          movementRef={movement}
          footfallRef={footfalls}
          gaitStyle={gaitStyle}
        />
        {attachedGuideSteps.has(guideStep) && (
          <Html
            center
            calculatePosition={placeCurvedLabel}
            position={[0, 2.65, 0]}
            distanceFactor={8}
            zIndexRange={[16, 14]}
            style={{ pointerEvents: 'none' }}
          >
            <TownGuide attached language={language} step={guideStep} ownerName={ownerName} petName={petName} />
          </Html>
        )}
      </group>
    </>
  )
}
