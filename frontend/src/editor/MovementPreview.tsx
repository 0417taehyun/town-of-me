import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { Group } from 'three'
import type { TownMovement } from '../data/models'
import type { PlayerProfile } from '../data/playerProfile'
import { GraphicsCanvas } from '../scene/GraphicsCanvas'
import { ProceduralCharacter } from '../scene/characters/ProceduralCharacter'
import type { CharacterAnimation } from '../scene/characters/Characters'
import { createPlayerMovement } from '../scene/motion/skidTurn'
import { createTrackTexture, stepMovementDemo, TRACK_LENGTH, type MovementDemoStep } from './movementDemo'

type StepLabels = Record<MovementDemoStep['label'], string>

/** The character walks, runs, turns back, and stops on a loop, side on, with the chosen walk and skid. */
export function MovementPreviewScene({
  movement,
  profile,
  labels,
  captionRef,
}: {
  movement: TownMovement
  profile: PlayerProfile
  labels: StepLabels
  captionRef: RefObject<HTMLSpanElement | null>
}) {
  const character = useRef<Group>(null)
  const demo = useRef({ x: 0, elapsed: 0 })
  const movementRef = useRef(createPlayerMovement(Math.PI / 2))
  const speedRef = useRef(0)
  const animationRef = useRef<CharacterAnimation>('idle')
  const track = useMemo(() => createTrackTexture(), [])
  useEffect(() => () => track.dispose(), [track])

  useFrame(({ camera }, delta) => {
    const step = stepMovementDemo(demo.current, movementRef.current, Math.min(delta, 0.05), movement.skid)
    const { velocity, yaw } = movementRef.current
    speedRef.current = Math.hypot(velocity.x, velocity.z)
    animationRef.current = speedRef.current < 0.12 ? 'idle' : 'walk'
    character.current?.position.set(demo.current.x, 0.87, 0)
    character.current?.rotation.set(0, yaw, 0)
    camera.position.set(demo.current.x, 2.2, 6.2)
    camera.lookAt(demo.current.x, 0.7, 0)
    if (captionRef.current) captionRef.current.textContent = labels[step.label]
  })

  return (
    <>
      <color attach="background" args={['#cfe3ea']} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[2, 6, 4]} intensity={2.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        {/* Segments let the town's world curve bend the track smoothly instead of tilting it from its far ends. */}
        <planeGeometry args={[TRACK_LENGTH * 2, 6, TRACK_LENGTH * 2, 4]} />
        <meshStandardMaterial map={track} roughness={1} />
      </mesh>
      <group ref={character}>
        <ProceduralCharacter
          profile={profile}
          animationRef={animationRef}
          speedRef={speedRef}
          movementRef={movementRef}
          gaitStyle={movement.gait}
        />
      </group>
    </>
  )
}

export function MovementPreview({
  movement,
  profile,
  labels,
  label,
}: {
  movement: TownMovement
  profile: PlayerProfile
  labels: StepLabels
  label: string
}) {
  const caption = useRef<HTMLSpanElement>(null)
  return (
    <figure className="editor-movement-preview" aria-label={label}>
      <div className="editor-movement-canvas">
        <GraphicsCanvas preview dpr={[1, 1.25]} camera={{ position: [0, 2.2, 6.2], fov: 34 }}>
          <MovementPreviewScene movement={movement} profile={profile} labels={labels} captionRef={caption} />
        </GraphicsCanvas>
      </div>
      <figcaption>
        <span ref={caption} aria-hidden="true" />
      </figcaption>
    </figure>
  )
}
