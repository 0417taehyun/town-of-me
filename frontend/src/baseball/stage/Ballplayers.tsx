import { useEffect, useImperativeHandle, useMemo, type Ref } from 'react'
import type { PlayerProfile } from '../../data/playerProfile'
import type { BattingSide } from '../game/field'
import { createBatter, disposeBatter } from './actors/batter'
import { type BallplayerCast, createCast, createFielders, disposeFielders } from './ballplayerCast'

/**
 * The visitor's character at bat on `side`, and the other team's pitcher and catcher; the derby director poses them
 * every frame. A new character or batting side makes a new batter.
 */
export function Ballplayers({
  ref,
  profile,
  side,
}: {
  ref: Ref<BallplayerCast>
  profile: PlayerProfile
  side: BattingSide
}) {
  const fielders = useMemo(() => createFielders(), [])
  const batter = useMemo(() => createBatter(profile, side), [profile, side])
  const cast = useMemo(() => createCast(batter, fielders), [batter, fielders])
  useImperativeHandle(ref, () => cast, [cast])
  useEffect(() => () => disposeBatter(batter), [batter])
  useEffect(() => () => disposeFielders(fielders), [fielders])
  return (
    <>
      <primitive object={batter.rig.root} />
      <primitive object={fielders.pitcher.rig.root} />
      <primitive object={fielders.catcher.rig.root} />
    </>
  )
}
