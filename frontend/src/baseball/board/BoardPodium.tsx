import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, NeutralToneMapping } from 'three'
import type { AppLanguage } from '../../i18n/language'
import { GraphicsCanvas } from '../../scene/GraphicsCanvas'
import { lookKey } from './boardView'
import { createPaintedStatue, type StatueLook } from '../../scene/statues/paintedStatue'
import { STATUE_RANKS, type StatueRank } from '../../scene/statues/statueFinishes'
import { createStatueTextures, disposeStatueTextures } from '../../scene/statues/statueTextures'
import {
  type Confetti,
  createPodiumStageGeometry,
  dropConfetti,
  framePodium,
  IDLE_SECONDS,
  idleMotion,
  launchConfetti,
  LOOK_HEIGHT,
  PODIUM_FOV,
  placeConfetti,
  plateShown,
  popScale,
  REVEAL,
  STACKED_WIDTH,
} from './podiumScene'

type PodiumProps = {
  /** First, second, and third place's look; `null` is an empty pedestal. */
  looks: readonly StatueLook[]
  /** Whether the statues rise third to first now; turning it off ends the rise at once. */
  revealing: boolean
  reducedMotion: boolean
  onPlateShown: (rank: StatueRank) => void
  onRevealEnd: () => void
}

/**
 * The three statues in one canvas, drawn only on demand: while they rise, while the confetti falls, and for the few
 * seconds they sway after appearing. It is decoration for sighted visitors: the plates say who stands where.
 */
export function BoardPodium({ language, ...props }: PodiumProps & { language: AppLanguage }) {
  return (
    <GraphicsCanvas
      language={language}
      preview
      aria-hidden="true"
      className="board-podium-canvas"
      frameloop="demand"
      dpr={[1, 1.15]}
      shadows="percentage"
      gl={{ alpha: true }}
      camera={{ fov: PODIUM_FOV, near: 0.1, far: 100, position: [0, 2.6, 9.5] }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping
      }}
    >
      <PodiumScene {...props} />
    </GraphicsCanvas>
  )
}

export function PodiumScene({ looks, revealing, reducedMotion, onPlateShown, onRevealEnd }: PodiumProps) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const invalidate = useThree((state) => state.invalidate)
  const [textures] = useState(createStatueTextures)
  const [stageGeometry] = useState(createPodiumStageGeometry)
  const root = useRef<Group>(null)
  const looksKey = looks.map(lookKey).join('|')
  const statues = useMemo(
    () => STATUE_RANKS.map((rank) => ({ rank, statue: createPaintedStatue(looks[rank - 1] ?? null, rank, textures) })),
    // The key stands for the looks, which a reloaded board hands over as new but equal objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [looksKey, textures],
  )
  const timeline = useRef({ revealStart: null as number | null, shown: new Set<StatueRank>(), motionEnds: 0 })
  const confetti = useRef<Confetti | null>(null)
  const stacked = size.width < STACKED_WIDTH
  const frame = useMemo(
    () => framePodium(size.width / Math.max(1, size.height), stacked),
    [size.height, size.width, stacked],
  )

  useEffect(() => () => disposeStatueTextures(textures), [textures])
  useEffect(() => () => stageGeometry.dispose(), [stageGeometry])
  useEffect(() => () => statues.forEach(({ statue }) => statue.dispose()), [statues])

  useLayoutEffect(() => {
    statues.forEach(({ rank, statue }) => {
      const slot = frame.slots[rank]
      statue.group.position.set(slot.x, 0, slot.z)
      statue.group.rotation.y = slot.turn
    })
    camera.position.set(0, LOOK_HEIGHT + frame.distance * frame.lift, frame.distance)
    camera.lookAt(0, LOOK_HEIGHT, 0)
    invalidate()
  }, [camera, frame, invalidate, statues])

  // A rise starts when asked, and ends early when the visitor taps or reduced motion is on; the statues then move a
  // few seconds on their own unless reduced motion is on.
  useEffect(() => {
    const seconds = performance.now() / 1000
    const line = timeline.current
    line.revealStart = revealing && !reducedMotion ? seconds : null
    line.shown = new Set()
    line.motionEnds = reducedMotion ? 0 : seconds + IDLE_SECONDS
    invalidate()
    const parent = root.current
    return () => {
      dropConfetti(confetti.current, parent)
      confetti.current = null
    }
  }, [invalidate, reducedMotion, revealing, statues])

  useFrame(() => {
    const seconds = performance.now() / 1000
    const line = timeline.current
    const elapsed = line.revealStart === null ? Number.POSITIVE_INFINITY : seconds - line.revealStart
    statues.forEach(({ rank, statue }) => {
      const scale = elapsed === Number.POSITIVE_INFINITY ? 1 : popScale(elapsed, rank)
      statue.group.scale.set(1, Math.max(0.001, scale), 1)
      statue.group.visible = scale > 0
    })
    const due = STATUE_RANKS.filter((rank) => plateShown(elapsed, rank) && !line.shown.has(rank))
    due.forEach((rank) => {
      line.shown.add(rank)
      onPlateShown(rank)
    })
    const burstDue = elapsed >= REVEAL.confettiAt && elapsed < REVEAL.end && !confetti.current
    if (burstDue) confetti.current = launchConfetti(root.current, frame.stage.radiusX * 2)
    const burstAge = elapsed - REVEAL.confettiAt
    const falling = confetti.current !== null && burstAge < REVEAL.confettiSeconds
    if (falling && confetti.current) placeConfetti(confetti.current, burstAge)
    const motion = reducedMotion ? 0 : idleMotion(seconds, line.motionEnds)
    statues.forEach(({ statue }) => statue.update(seconds, motion))
    const rising = elapsed < REVEAL.end
    if (line.revealStart !== null && !rising) {
      line.revealStart = null
      onRevealEnd()
    }
    if (motion > 0 || rising || falling) invalidate()
  })

  return (
    <group ref={root}>
      <hemisphereLight args={['#fff8ea', '#b9ad92', 1.6]} />
      <directionalLight
        color="#fff1d6"
        intensity={2.2}
        position={[1.4, 8.5, 5.2]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-5.5}
        shadow-camera-right={5.5}
        shadow-camera-top={5.5}
        shadow-camera-bottom={-5.5}
        shadow-camera-near={1}
        shadow-camera-far={22}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
      />
      <mesh
        geometry={stageGeometry}
        scale={[frame.stage.radiusX, 1, frame.stage.radiusZ]}
        position={[0, 0, frame.stage.z]}
        receiveShadow
      >
        <meshStandardMaterial color="#e3d5b5" roughness={0.92} />
      </mesh>
      {statues.map(({ rank, statue }) => (
        <primitive key={rank} object={statue.group} />
      ))}
    </group>
  )
}
