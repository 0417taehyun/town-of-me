import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Group, type Vector3 } from 'three'
import type { TownPoint } from '../../data/models'
import { ContactShadowBlob } from '../ContactShadows'
import { fadeContactShadow, type ContactShadowMesh } from '../contactShadow'
import { canActorOccupyPosition, stepGreetingBounce, updateNameTag } from '../motion/npcMotion'
import type { GreetingBounce, RoundObstacle, WorldActor } from '../motion/npcMotion'
import { closeEyes, getBlinkAmount } from '../motion/playerMotion'
import { getCorgiGait, poseCorgiLeg, walkCorgiRoute } from './corgiGait'
import { damp, dampAngle } from '../../motionMath'
import { placeCurvedLabel, WORLD_LABEL_LAYERS } from '../worldLabels'
import { getRoundedBox } from '../roundedBox'

const CORGI_EYE_HEIGHT = 0.12
const CORGI_BLINK_SEED = -1

export function Corgi({
  actor,
  name,
  breed,
  route,
  playerPosition,
  actors,
  reducedMotion,
  obstacles,
}: {
  actor: WorldActor
  name: string
  breed: string
  /** The loop the corgi trots; it starts at the first point and follows changes from wherever it is. */
  route: readonly TownPoint[]
  playerPosition: MutableRefObject<Vector3>
  actors: MutableRefObject<WorldActor[]>
  reducedMotion: boolean
  obstacles: RoundObstacle[]
}) {
  const [[startX, startZ]] = useState(() => route[0])
  const root = useRef<Group>(null)
  const model = useRef<Group>(null)
  const head = useRef<Group>(null)
  const legs = useRef<Array<Group | null>>([null, null, null, null])
  const paws = useRef<Array<Group | null>>([null, null, null, null])
  const gait = useRef(getCorgiGait(0, 0, false, reducedMotion))
  const tail = useRef<Group>(null)
  const smile = useRef<Group>(null)
  const eyes = useRef<Group>(null)
  const shadow = useRef<ContactShadowMesh>(null)
  const bounce = useRef<GreetingBounce>({ active: false, startedAt: -Infinity })
  const nameTag = useRef<HTMLDivElement>(null)
  const state = useRef({ routeIndex: 1, waitUntil: 0, speed: 0 })
  const walking = useRef(true)
  const walkStrength = useRef(0)

  useFrame(({ clock }, rawDelta) => {
    const node = root.current
    if (!node) return
    const elapsed = clock.elapsedTime
    const delta = Math.min(rawDelta, 0.05)
    const happy = actor.interactionUntil > performance.now()
    const previousX = node.position.x
    const previousZ = node.position.z
    if (happy) state.current.speed = 0
    walking.current = !happy && walkCorgiRoute(node, state.current, route, elapsed, delta)
    const free =
      !walking.current ||
      canActorOccupyPosition(actor, node.position.x, node.position.z, actors.current, playerPosition.current, obstacles)
    if (!free) {
      node.position.x = previousX
      node.position.z = previousZ
      state.current.waitUntil = elapsed + 0.25
      state.current.speed = 0
      walking.current = false
    }
    if (happy) {
      const desired = Math.atan2(playerPosition.current.x - node.position.x, playerPosition.current.z - node.position.z)
      node.rotation.y = dampAngle(node.rotation.y, desired, 10, delta)
    }
    walkStrength.current = damp(walkStrength.current, Number(walking.current), 9, delta)
    const pose = getCorgiGait(elapsed, walkStrength.current, happy, reducedMotion, gait.current)
    if (model.current) {
      model.current.position.y = pose.bodyY
      model.current.rotation.z = pose.bodyTilt
    }
    if (head.current) head.current.rotation.x = pose.headTilt
    if (tail.current) tail.current.rotation.z = -0.65 + pose.tailWag
    for (let index = 0; index < 4; index += 1)
      poseCorgiLeg(legs.current[index], paws.current[index], pose.angles[index], pose.lifts[index])
    if (smile.current) smile.current.visible = happy
    if (eyes.current) eyes.current.visible = !happy
    closeEyes(eyes.current, getBlinkAmount(elapsed, CORGI_BLINK_SEED), CORGI_EYE_HEIGHT)
    fadeContactShadow(shadow.current, pose.bodyY)
    const stretch = stepGreetingBounce(bounce.current, happy, elapsed, reducedMotion)
    node.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch))
    actor.position.set(node.position.x, 0.7, node.position.z)
    updateNameTag(nameTag.current, actor.position, playerPosition.current)
  }, -3)

  return (
    <group ref={root} position={[startX, 0, startZ]}>
      <ContactShadowBlob ref={shadow} width={1.3} depth={2.1} />
      <group ref={model}>
        <mesh position={[0, 0.62, 0]} castShadow>
          <primitive object={getRoundedBox(0.8, 0.7, 1.45, 0.24)} attach="geometry" />
          <meshStandardMaterial color="#d88a43" roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.66, 0.5]}>
          <primitive object={getRoundedBox(0.52, 0.5, 0.5, 0.2)} attach="geometry" />
          <meshStandardMaterial color="#fff0d2" />
        </mesh>
        <group ref={head} position={[0, 1.08, 0.62]}>
          <mesh castShadow>
            <primitive object={getRoundedBox(0.82, 0.78, 0.72, 0.26)} attach="geometry" />
            <meshStandardMaterial color="#dc8c43" roughness={0.95} />
          </mesh>
          <mesh position={[0, -0.1, 0.41]}>
            <primitive object={getRoundedBox(0.48, 0.34, 0.32, 0.13)} attach="geometry" />
            <meshStandardMaterial color="#fff0d2" />
          </mesh>
          <mesh position={[0, -0.06, 0.59]}>
            <primitive object={getRoundedBox(0.17, 0.12, 0.08, 0.03)} attach="geometry" />
            <meshStandardMaterial color="#3e332f" />
          </mesh>
          <group ref={eyes}>
            {[-0.23, 0.23].map((x) => (
              <mesh key={`eye-${x}`} position={[x, CORGI_EYE_HEIGHT, 0.37]}>
                <sphereGeometry args={[0.055, 14, 10]} />
                <meshStandardMaterial color="#332c29" />
              </mesh>
            ))}
          </group>
          <group ref={smile} visible={false}>
            {[-0.23, 0.23].map((x) => (
              <mesh key={x} position={[x, 0.1, 0.383]}>
                <torusGeometry args={[0.063, 0.017, 8, 16, Math.PI]} />
                <meshBasicMaterial color="#332c29" />
              </mesh>
            ))}
            <mesh position={[0, -0.215, 0.59]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.13, 0.026, 8, 18, Math.PI]} />
              <meshBasicMaterial color="#4c302e" />
            </mesh>
            <mesh position={[0, -0.31, 0.6]} scale={[1, 1.35, 0.4]}>
              <sphereGeometry args={[0.063, 14, 10]} />
              <meshStandardMaterial color="#ee9b9b" />
            </mesh>
          </group>
          {[-0.29, 0.29].map((x) => (
            <mesh key={`ear-${x}`} position={[x, 0.47, -0.07]} rotation={[0, 0, x * -0.9]} castShadow>
              <coneGeometry args={[0.2, 0.48, 10]} />
              <meshStandardMaterial color="#b96537" />
            </mesh>
          ))}
        </group>
        <group ref={tail} position={[0, 0.92, -0.78]} rotation={[0.25, 0, -0.65]}>
          <mesh position={[0, 0.32, 0]} castShadow>
            <coneGeometry args={[0.16, 0.7, 12]} />
            <meshStandardMaterial color="#d88a43" />
          </mesh>
        </group>
      </group>
      {[
        [-0.27, 0.46],
        [0.27, 0.46],
        [-0.27, -0.46],
        [0.27, -0.46],
      ].map(([x, z], index) => (
        <group
          key={index}
          ref={(node) => {
            legs.current[index] = node
          }}
          position={[x, 0.44, z]}
        >
          <mesh position={[0, -0.16, 0]} castShadow>
            <primitive object={getRoundedBox(0.22, 0.32, 0.25, 0.08)} attach="geometry" />
            <meshStandardMaterial color={z > 0 ? '#fff0d2' : '#c9753a'} />
          </mesh>
          <group
            ref={(node) => {
              paws.current[index] = node
            }}
            position={[0, -0.36, 0]}
          >
            <mesh castShadow>
              <primitive object={getRoundedBox(0.26, 0.16, 0.33, 0.065)} attach="geometry" />
              <meshStandardMaterial color="#fff0d2" />
            </mesh>
          </group>
        </group>
      ))}
      <Html
        center
        position={[0, 1.9, 0]}
        distanceFactor={12}
        zIndexRange={WORLD_LABEL_LAYERS}
        calculatePosition={placeCurvedLabel}
        style={{ pointerEvents: 'none' }}
      >
        <div ref={nameTag} className="character-name proximity-name pet-name">
          {name} <span>{breed}</span>
        </div>
      </Html>
    </group>
  )
}
