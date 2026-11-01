import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, type MutableRefObject } from 'react'
import type { PlayerProfile } from '../../data/playerProfile'
import type { BallView } from '../stage/ballMeshes'
import type { StageRun } from '../stage/stageRun'
import { createFieldCrew, crewSeconds, disposeFieldCrew, playFieldCrew } from './fieldCrewPlay'

/**
 * The fielders, the umpire, our runner, and our teammates (fieldCrewPlay.ts), playing `stageRef`'s run and watching
 * `ballViewRef`'s ball; a `reduced` performance tier leaves our teammates out. New `approved` looks dress a new crew.
 */
export function FieldCrew({
  stageRef,
  ballViewRef,
  approved,
  reduced,
  reducedMotion,
}: {
  stageRef: MutableRefObject<StageRun | null>
  ballViewRef: MutableRefObject<BallView | null>
  approved: readonly PlayerProfile[]
  reduced: boolean
  reducedMotion: boolean
}) {
  const crew = useMemo(() => createFieldCrew(approved, !reduced), [approved, reduced])
  useEffect(() => () => disposeFieldCrew(crew), [crew])
  useFrame((_, delta) => {
    const run = stageRef.current
    const seconds = crewSeconds(crew, run, performance.now(), delta)
    playFieldCrew(crew, run, ballViewRef.current, seconds, delta, reducedMotion)
  })
  return (
    <>
      {crew.everyone.map((member) => (
        <primitive key={member.player.rig.root.uuid} object={member.player.rig.root} />
      ))}
      <primitive object={crew.batch.group} />
    </>
  )
}
