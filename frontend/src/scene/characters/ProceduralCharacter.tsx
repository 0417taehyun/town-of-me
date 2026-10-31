import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Euler, Group, Quaternion, Vector3 } from 'three'
import type { PlayerProfile } from '../../data/playerProfile'
import type { CharacterAnimation } from './Characters'
import { ContactShadowBlob } from '../ContactShadows'
import { getAvatarAppearance, type AvatarPart } from './avatarAppearance'
import {
  applyPose,
  BENCH_SURFACE_HEIGHT,
  CHARACTER_ORIGIN_OFFSET,
  getAnimationSpeed,
  SEATED_ROOT_HEIGHT,
} from '../motion/characterPose'
import { placeCharacterShadow, type ContactShadowMesh } from '../contactShadow'
import { addPettingPose, closeEyes, getBlinkAmount, getTalkingPose, PLAYER_WALK_SPEED } from '../motion/playerMotion'
import { addMovementPose, noteLeadingLeg, type PlayerMovement } from '../motion/skidTurn'
import { createGait } from '../motion/createGait'
import type { GaitStyle } from '../motion/gait'
import { blendPose, createRestPose, setPoseOnGround, type CharacterPose } from '../motion/walkCycle'
import { lerp } from '../../motionMath'
import { getRoundedBox } from '../roundedBox'
import { characterGeometries, mergeAvatarParts } from './characterGeometries'

const MOUTH_PART_IDS = new Set(['smile', 'grin', 'teeth', 'quiet'])
const standingAt = new Vector3()
const facing = new Quaternion()
const facingAngles = new Euler()
const EYE_PART_IDS = new Set(['eye--1', 'eye-1'])

const seatedPose: CharacterPose = Object.assign(createRestPose(), {
  bodyY: BENCH_SURFACE_HEIGHT + 0.11 - SEATED_ROOT_HEIGHT - 0.73 - CHARACTER_ORIGIN_OFFSET,
  leftArm: -0.4,
  rightArm: -0.4,
  leftLeg: -Math.PI / 2,
  rightLeg: -Math.PI / 2,
  leftKnee: Math.PI / 2,
  rightKnee: Math.PI / 2,
})

export function HeadPart({ part }: { part: AvatarPart }) {
  // Eyes, brows, and other small details are too small to cast a visible shadow.
  return (
    <mesh
      position={part.position}
      scale={part.scale}
      rotation={part.rotation}
      castShadow={Math.max(...part.scale) > 0.15}
    >
      <primitive object={characterGeometries[part.shape]} attach="geometry" />
      <meshStandardMaterial color={part.color} roughness={0.9} />
    </mesh>
  )
}

export function ProceduralCharacter({
  profile,
  animationRef,
  speedRef,
  walkSpeed = PLAYER_WALK_SPEED,
  headTiltRef,
  headYawRef,
  stretchRef,
  pettingRef,
  talkingRef,
  movementRef,
  footfallRef,
  gaitStyle = 'plantedFeet',
  expressionPhase = 0,
  blinkSeed = 0,
}: {
  profile: PlayerProfile
  animationRef?: MutableRefObject<CharacterAnimation>
  speedRef?: MutableRefObject<number>
  walkSpeed?: number
  headTiltRef?: MutableRefObject<number>
  /** Already eased by the owner, applied as it is. */
  headYawRef?: MutableRefObject<number>
  /** Vertical scale of the body about the feet, with the width keeping its volume. */
  stretchRef?: MutableRefObject<number>
  pettingRef?: MutableRefObject<boolean>
  talkingRef?: MutableRefObject<boolean>
  /** The player's skids, brakes, and leans; residents only walk. */
  movementRef?: MutableRefObject<PlayerMovement>
  /** Counts each foot touching down, for footstep sounds. */
  footfallRef?: MutableRefObject<number>
  gaitStyle?: GaitStyle
  expressionPhase?: number
  blinkSeed?: number
}) {
  const appearance = useMemo(() => getAvatarAppearance(profile), [profile])
  const eyeHeight = appearance.headParts.find((part) => EYE_PART_IDS.has(part.id))?.position[1] ?? 0
  const fixedHead = useMemo(
    () =>
      mergeAvatarParts(
        appearance.headParts.filter((part) => !MOUTH_PART_IDS.has(part.id) && !EYE_PART_IDS.has(part.id)),
      ),
    [appearance],
  )
  useEffect(() => () => fixedHead.dispose(), [fixedHead])
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const defaultMouth = useRef<Group>(null)
  const defaultEyes = useRef<Group>(null)
  const talkingFace = useRef<Group>(null)
  const talkingMouth = useRef<Group>(null)
  const happyEyes = useRef<Group>(null)
  const blinkingEyes = useRef<Group>(null)
  const talkingCheeks = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)
  const leftLeg = useRef<Group>(null)
  const rightLeg = useRef<Group>(null)
  const leftKnee = useRef<Group>(null)
  const rightKnee = useRef<Group>(null)
  const leftAnkle = useRef<Group>(null)
  const rightAnkle = useRef<Group>(null)
  const shadow = useRef<ContactShadowMesh>(null)
  const gait = useMemo(() => createGait(gaitStyle), [gaitStyle])
  const pose = useMemo(() => createRestPose(), [])
  const blends = useRef({ seated: 0, petting: 0, headTilt: 0 })

  useFrame(({ clock }, delta) => {
    if (!animationRef || !body.current) return
    const animation = animationRef.current
    const seated = animation === 'sit'
    const speed = speedRef?.current ?? getAnimationSpeed(animation)
    const movement = movementRef?.current
    const talking = Boolean(talkingRef?.current)
    const talkingPose = getTalkingPose(clock.elapsedTime + expressionPhase, talking)
    const ease = 1 - Math.exp(-12 * Math.min(delta, 0.05))
    const weights = blends.current
    weights.seated = lerp(weights.seated, Number(seated), ease)
    weights.petting = lerp(weights.petting, Number(!seated && Boolean(pettingRef?.current)), ease)
    weights.headTilt = lerp(weights.headTilt, (headTiltRef?.current ?? 0) + talkingPose.headNod, ease)
    // The feet are planted in town coordinates, so the gait needs where the character stands and faces.
    body.current.parent?.getWorldPosition(standingAt)
    body.current.parent?.getWorldQuaternion(facing)
    const yaw = facingAngles.setFromQuaternion(facing, 'YXZ').y
    const advancing = !movement || movement.mode === 'move'
    // The walk is applied as it is: easing it again here would shrink and delay every step.
    gait.step({ speed: seated ? 0 : speed, delta, walkSpeed, advancing, x: standingAt.x, z: standingAt.z, yaw }, pose)
    if (movement) addMovementPose(pose, movement)
    if (footfallRef) footfallRef.current = gait.footfalls()
    addPettingPose(pose, clock.elapsedTime, weights.petting)
    setPoseOnGround(pose)
    blendPose(pose, seatedPose, weights.seated)
    if (movement) noteLeadingLeg(movement, pose)
    applyPose(
      { body, head, leftArm, rightArm, leftLeg, rightLeg, leftKnee, rightKnee, leftAnkle, rightAnkle },
      pose,
      weights.headTilt,
      headYawRef?.current ?? 0,
    )
    const stretch = stretchRef?.current ?? 1
    body.current.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch))
    placeCharacterShadow(shadow.current, body.current)
    closeEyes(defaultEyes.current, getBlinkAmount(clock.elapsedTime, blinkSeed), eyeHeight)
    if (defaultMouth.current) defaultMouth.current.visible = !talking
    if (defaultEyes.current) defaultEyes.current.visible = !talking || talkingPose.eyeExpression === 'open'
    if (talkingFace.current) talkingFace.current.visible = talking
    if (happyEyes.current) happyEyes.current.visible = talkingPose.eyeExpression === 'happy'
    if (blinkingEyes.current) blinkingEyes.current.visible = talkingPose.eyeExpression === 'blink'
    if (talkingCheeks.current) talkingCheeks.current.visible = talkingPose.eyeExpression === 'happy'
    if (!talkingMouth.current) return
    talkingMouth.current.scale.x = lerp(talkingMouth.current.scale.x, talkingPose.mouthWidth, ease)
    talkingMouth.current.scale.y = lerp(talkingMouth.current.scale.y, talkingPose.mouthOpen, ease)
  })

  return (
    <>
      {animationRef && <ContactShadowBlob ref={shadow} width={1.15} depth={1.15} />}
      <group ref={body} position={[0, CHARACTER_ORIGIN_OFFSET, 0]}>
        <mesh position={[0, 1.04, 0]} castShadow>
          <primitive object={getRoundedBox(0.64, 0.64, 0.38, 0.14)} attach="geometry" />
          <meshStandardMaterial color={appearance.top} roughness={1} />
        </mesh>
        {appearance.collar &&
          [-1, 1].map((side) => (
            <mesh key={`collar-${side}`} position={[side * 0.09, 1.31, 0.21]} rotation={[0, 0, side * 0.35]}>
              <primitive object={getRoundedBox(0.16, 0.12, 0.04, 0.015)} attach="geometry" />
              <meshStandardMaterial color="#eee6d5" roughness={1} />
            </mesh>
          ))}
        <group ref={head} position={[0, 1.67, 0]}>
          <mesh geometry={fixedHead} castShadow>
            <meshStandardMaterial vertexColors roughness={0.9} />
          </mesh>
          <group ref={defaultEyes}>
            {appearance.headParts
              .filter((part) => EYE_PART_IDS.has(part.id))
              .map((part) => (
                <HeadPart key={part.id} part={part} />
              ))}
          </group>
          <group ref={defaultMouth}>
            {appearance.headParts
              .filter((part) => MOUTH_PART_IDS.has(part.id))
              .map((part) => (
                <HeadPart key={part.id} part={part} />
              ))}
          </group>
          <group ref={talkingFace} visible={false}>
            <group ref={talkingMouth}>
              <mesh position={[0, -0.18, 0.375]}>
                <primitive object={getRoundedBox(0.18, 0.075, 0.035, 0.03)} attach="geometry" />
                <meshStandardMaterial color="#3b2928" roughness={1} />
              </mesh>
              <mesh position={[0, -0.203, 0.398]}>
                <primitive object={getRoundedBox(0.075, 0.018, 0.012, 0.008)} attach="geometry" />
                <meshStandardMaterial color="#e58d8d" roughness={1} />
              </mesh>
            </group>
            <group ref={happyEyes} visible={false}>
              {[-1, 1].map((side) => (
                <mesh key={`happy-eye-${side}`} position={[side * 0.15, 0.07, 0.365]} scale={[1, 0.72, 1]}>
                  <primitive object={characterGeometries.happyEye} attach="geometry" />
                  <meshStandardMaterial color="#352b29" roughness={1} />
                </mesh>
              ))}
            </group>
            <group ref={blinkingEyes} visible={false}>
              {[-1, 1].map((side) => (
                <mesh key={`blink-eye-${side}`} position={[side * 0.15, 0.07, 0.365]}>
                  <primitive object={getRoundedBox(0.105, 0.018, 0.025, 0.008)} attach="geometry" />
                  <meshStandardMaterial color="#352b29" roughness={1} />
                </mesh>
              ))}
            </group>
            <group ref={talkingCheeks} visible={false}>
              {[-1, 1].map((side) => (
                <mesh key={`talking-cheek-${side}`} position={[side * 0.25, -0.1, 0.35]} scale={[0.055, 0.026, 0.016]}>
                  <primitive object={characterGeometries.smallSphere} attach="geometry" />
                  <meshStandardMaterial color="#eaa0a0" roughness={1} />
                </mesh>
              ))}
            </group>
            {[-1, 1].map((side) => (
              <mesh key={`talking-brow-${side}`} position={[side * 0.15, 0.18, 0.355]} rotation={[0, 0, side * 0.12]}>
                <primitive object={getRoundedBox(0.12, 0.022, 0.022, 0.01)} attach="geometry" />
                <meshStandardMaterial color="#352b29" roughness={1} />
              </mesh>
            ))}
          </group>
        </group>
        {[-1, 1].map((side) => (
          <group key={`arm-${side}`} ref={side < 0 ? leftArm : rightArm} position={[side * 0.43, 1.25, 0]}>
            <mesh position={[0, -0.12, 0]} castShadow>
              <primitive
                object={getRoundedBox(0.2, appearance.longSleeves ? 0.45 : 0.25, 0.27, 0.08)}
                attach="geometry"
              />
              <meshStandardMaterial color={appearance.top} roughness={1} />
            </mesh>
            <mesh position={[0, -0.38, 0]} castShadow>
              <primitive object={characterGeometries.hand} attach="geometry" />
              <meshStandardMaterial color={appearance.skin} roughness={1} />
            </mesh>
          </group>
        ))}
        {[-1, 1].map((side) => (
          <group key={`leg-${side}`} ref={side < 0 ? leftLeg : rightLeg} position={[side * 0.17, 0.73, 0]}>
            <mesh position={[0, -0.18, 0]} castShadow>
              <primitive object={getRoundedBox(appearance.relaxed ? 0.3 : 0.24, 0.36, 0.28, 0.08)} attach="geometry" />
              <meshStandardMaterial color={appearance.bottom} roughness={1} />
            </mesh>
            <group ref={side < 0 ? leftKnee : rightKnee} position={[0, -0.36, 0]}>
              <mesh position={[0, -0.14, 0]} castShadow>
                <primitive
                  object={getRoundedBox(appearance.relaxed ? 0.27 : 0.21, 0.28, 0.24, 0.075)}
                  attach="geometry"
                />
                <meshStandardMaterial color={appearance.shorts ? appearance.skin : appearance.bottom} roughness={1} />
              </mesh>
              <group ref={side < 0 ? leftAnkle : rightAnkle} position={[0, -0.29, 0]}>
                <mesh position={[0, appearance.boots ? 0.05 : 0, 0.07]} castShadow>
                  <primitive
                    object={getRoundedBox(0.27, appearance.boots ? 0.25 : 0.15, 0.41, appearance.boots ? 0.08 : 0.055)}
                    attach="geometry"
                  />
                  <meshStandardMaterial color={appearance.shoes} roughness={0.85} />
                </mesh>
              </group>
            </group>
          </group>
        ))}
      </group>
    </>
  )
}
