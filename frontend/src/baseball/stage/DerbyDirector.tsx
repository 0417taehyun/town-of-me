import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import type { PlayerProfile } from '../../data/playerProfile'
import type { BattingSide } from '../game/field'
import { gameTime } from '../game/gameClock'
import { Ball } from './Ball'
import { type BallParts, drawBall } from './ballMeshes'
import { type BallplayerCast, posePitcherAt, posePlayers, settleBatter } from './ballplayerCast'
import { Ballplayers } from './Ballplayers'
import { aimCamera, centreInBand, createCameraRig, type FreeBand } from './cameraShots'
import {
  createStageRun,
  directedShot,
  playStageFrame,
  type RealTimeSwing,
  type RealTimeSwingCue,
  resumeStageRun,
  setStageRunPaused,
  type StageEvent,
  type StageRun,
  type StageRunSetup,
  stageBallView,
} from './stageRun'
import { createStrikeZoneOutline, disposeStrikeZoneOutline, drawStrikeZoneOutline } from './strikeZoneOutline'

/**
 * Plays a run in one frame loop: the derby on its game clock, the players, the ball, the strike zone's box, and the
 * camera, all in refs. React hears only the events. The batter's swing is settled before anything is drawn: a hit
 * waits, the clock still, while its aim is solved a slice a frame (ballplayerCast.ts settleBatter), so no frame solves
 * it at once. The pitcher is posed first, since the ball is in his hand until it is released. A new `run` starts over.
 * Swings pushed onto `swings` are taken every frame and played at the moment they report, after the cues of swings
 * begun or checked pushed onto `swingCues`, which only the batter shows; one from before the run's first pitch is
 * ignored like any swing with no pitch on its way. The run's clock stops while the page is hidden, when frames stop
 * too, so no pitch goes by unseen, and while it is `paused`, which the page sets only between pitches for a visitor out
 * of the camera's view, so no ball stops in the air. The picture is centred in `band` (px), the part of the screen the
 * camera panel leaves free.
 */
export function DerbyDirector({
  run,
  profile,
  side,
  swings,
  swingCues,
  onEvent,
  band,
  paused,
  reducedMotion,
}: {
  run: StageRunSetup | null
  profile: PlayerProfile
  side: BattingSide
  swings: MutableRefObject<RealTimeSwing[]>
  swingCues: MutableRefObject<RealTimeSwingCue[]>
  onEvent: (event: StageEvent) => void
  band: FreeBand
  paused: boolean
  reducedMotion: boolean
}) {
  const ball = useRef<BallParts>(null)
  const players = useRef<BallplayerCast>(null)
  const stage = useRef<StageRun | null>(null)
  const lastGameMs = useRef(0)
  const listener = useRef(onEvent)
  const pausedByPage = useRef(paused)
  const rig = useMemo(() => createCameraRig(), [])
  const outline = useMemo(() => createStrikeZoneOutline(), [])
  useEffect(() => () => disposeStrikeZoneOutline(outline), [outline])
  useLayoutEffect(() => {
    listener.current = onEvent
  }, [onEvent])
  useLayoutEffect(() => {
    stage.current = run ? createStageRun(run, performance.now()) : null
    lastGameMs.current = 0
    if (stage.current && pausedByPage.current) setStageRunPaused(stage.current, performance.now(), true)
  }, [run])
  useLayoutEffect(() => {
    pausedByPage.current = paused
    if (stage.current) setStageRunPaused(stage.current, performance.now(), paused || document.hidden)
  }, [paused])
  useEffect(() => {
    const onVisibilityChange = () => {
      const pausing = document.hidden || pausedByPage.current
      if (stage.current) setStageRunPaused(stage.current, performance.now(), pausing)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useFrame((state, delta) => {
    const realMs = performance.now()
    const current = stage.current
    const reported = swings.current.splice(0)
    const cues = swingCues.current.splice(0)
    const events = current ? playStageFrame(current, reported, realMs, reducedMotion, cues, true) : []
    events.forEach((event) => listener.current(event))
    const cast = players.current
    const caughtUp = !cast || settleBatter(cast, current, realMs)
    if (current && caughtUp) resumeStageRun(current, realMs)
    const nowMs = current ? gameTime(current.clock, realMs) : 0
    const gameDelta = Math.max(0, nowMs - lastGameMs.current) / 1000
    lastGameMs.current = nowMs
    const camera = state.camera as PerspectiveCamera
    const view = stageBallView(current, nowMs, cast && posePitcherAt(cast, current, nowMs))
    const { width, height } = state.size
    centreInBand(camera, rig, band, width, height, delta, reducedMotion)
    const aspect = band.width / Math.max(1, height)
    aimCamera(camera, rig, directedShot(current, nowMs, aspect, side, view.position), delta)
    if (ball.current) drawBall(ball.current, view, camera, state.size.height, gameDelta)
    drawStrikeZoneOutline(outline, current?.derby.phase ?? null, delta, reducedMotion)
    if (cast) posePlayers(cast, current, nowMs, view, delta)
  })

  return (
    <>
      <Ballplayers ref={players} profile={profile} side={side} />
      <Ball ref={ball} />
      <primitive object={outline} />
    </>
  )
}
