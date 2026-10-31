import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { PlayerProfile } from '../../data/playerProfile'
import type { BattingSide } from '../game/field'
import { gameTime } from '../game/gameClock'
import { Ball } from './Ball'
import { type BallParts, drawBall } from './ballMeshes'
import { type BallplayerCast, posePitcherAt, posePlayers } from './ballplayerCast'
import { Ballplayers } from './Ballplayers'
import { aimCamera, centreInBand, createCameraRig, type FreeBand } from './cameraShots'
import {
  createStageRun,
  directedShot,
  playStageFrame,
  type RealTimeSwing,
  setStageRunPaused,
  type StageEvent,
  type StageRun,
  type StageRunSetup,
  stageBallView,
} from './stageRun'

/**
 * Plays a run in one frame loop: the derby on its game clock, the players, the ball, and the camera, all in refs. React
 * hears only the events. The pitcher is posed first, since the ball is in his hand until it is released. A new `run`
 * starts over. Swings pushed onto `swings` are taken every frame and played at the moment they report; one from before
 * the run's first pitch is ignored like any swing with no pitch on its way. The run's clock stops while the page is
 * hidden, when frames stop too, so no pitch goes by unseen. The picture is centred in `band` (px), the part of the
 * screen the camera panel leaves free.
 */
export function DerbyDirector({
  run,
  profile,
  side,
  swings,
  onEvent,
  band,
  reducedMotion,
}: {
  run: StageRunSetup | null
  profile: PlayerProfile
  side: BattingSide
  swings: MutableRefObject<RealTimeSwing[]>
  onEvent: (event: StageEvent) => void
  band: FreeBand
  reducedMotion: boolean
}) {
  const ball = useRef<BallParts>(null)
  const players = useRef<BallplayerCast>(null)
  const stage = useRef<StageRun | null>(null)
  const lastGameMs = useRef(0)
  const listener = useRef(onEvent)
  const rig = useMemo(() => createCameraRig(), [])
  useLayoutEffect(() => {
    listener.current = onEvent
  }, [onEvent])
  useLayoutEffect(() => {
    stage.current = run ? createStageRun(run, performance.now()) : null
    lastGameMs.current = 0
  }, [run])
  useEffect(() => {
    const onVisibilityChange = () => {
      if (stage.current) setStageRunPaused(stage.current, performance.now(), document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useFrame((state, delta) => {
    const realMs = performance.now()
    const current = stage.current
    const reported = swings.current.splice(0)
    const events = current ? playStageFrame(current, reported, realMs, reducedMotion) : []
    events.forEach((event) => listener.current(event))
    const nowMs = current ? gameTime(current.clock, realMs) : 0
    const gameDelta = Math.max(0, nowMs - lastGameMs.current) / 1000
    lastGameMs.current = nowMs
    const camera = state.camera as PerspectiveCamera
    const cast = players.current
    const view = stageBallView(current, nowMs, cast && posePitcherAt(cast, current, nowMs))
    const { width, height } = state.size
    centreInBand(camera, rig, band, width, height, delta, reducedMotion)
    const aspect = band.width / Math.max(1, height)
    aimCamera(camera, rig, directedShot(current, nowMs, aspect, side, view.position), delta)
    if (ball.current) drawBall(ball.current, view, camera, state.size.height, gameDelta)
    if (cast) posePlayers(cast, current, nowMs, view, delta)
  })

  return (
    <>
      <Ballplayers ref={players} profile={profile} side={side} />
      <Ball ref={ball} />
    </>
  )
}
