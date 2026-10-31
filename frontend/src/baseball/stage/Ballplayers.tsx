import { useRef } from 'react'
import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../data/playerProfile'
import type { CharacterAnimation } from '../../scene/characters/Characters'
import { ProceduralCharacter } from '../../scene/characters/ProceduralCharacter'
import { CHARACTER_ORIGIN_OFFSET } from '../../scene/motion/characterPose'
import type { BattingSide } from '../game/field'
import { batterSpot, CATCHER_SPOT, PITCHER_SPOT, PLAYER_SCALE } from './stageLayout'

// Stand-ins until the ballplayer rigs (PR 7): town characters standing where the players play, the batter as the
// visitor's own character. Each is lifted by the character's origin offset so its feet rest on the ground, as in the
// town. The catcher sits on the ground so the strike zone stays in sight over his head.

const PITCHER: PlayerProfile = {
  ...DEFAULT_PLAYER_PROFILE,
  name: 'Pitcher',
  hat: 'cap',
  colors: { ...DEFAULT_PLAYER_PROFILE.colors, hat: '#374b65', top: '#ece3cc', bottom: '#374b65' },
}
const CATCHER: PlayerProfile = {
  ...PITCHER,
  name: 'Catcher',
  hair: 'curls',
  colors: { ...PITCHER.colors, skin: '#e9ba99', hair: '#a75838' },
}

export function StandingPlayer({
  profile,
  position,
  yaw,
  animation,
}: {
  profile: PlayerProfile
  position: { x: number; y: number; z: number }
  yaw: number
  animation: CharacterAnimation
}) {
  const animationRef = useRef(animation)
  return (
    <group position={[position.x, position.y, position.z]} rotation-y={yaw} scale={PLAYER_SCALE}>
      <group position-y={-CHARACTER_ORIGIN_OFFSET}>
        <ProceduralCharacter profile={profile} animationRef={animationRef} />
      </group>
    </group>
  )
}

export function Ballplayers({ profile, side }: { profile: PlayerProfile; side: BattingSide }) {
  const batter = batterSpot(side)
  return (
    <>
      <StandingPlayer profile={PITCHER} position={PITCHER_SPOT} yaw={0} animation="idle" />
      <StandingPlayer profile={CATCHER} position={CATCHER_SPOT} yaw={Math.PI} animation="sit" />
      <StandingPlayer
        profile={profile}
        position={batter}
        yaw={side === 'left' ? -Math.PI / 2 : Math.PI / 2}
        animation="idle"
      />
    </>
  )
}
