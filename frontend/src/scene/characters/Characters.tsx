import type { MutableRefObject } from 'react'
import type { PlayerProfile } from '../../data/playerProfile'
import { ProceduralCharacter } from './ProceduralCharacter'
import type { PlayerMovement } from '../motion/skidTurn'
import type { GaitStyle } from '../motion/gait'

export type CharacterAnimation = 'idle' | 'walk' | 'sprint' | 'sit'

export function Character({
  profile,
  animationRef,
  speedRef,
  walkSpeed,
  headTiltRef,
  headYawRef,
  stretchRef,
  pettingRef,
  talkingRef,
  movementRef,
  footfallRef,
  gaitStyle,
  expressionPhase,
  blinkSeed,
}: {
  animationRef: MutableRefObject<CharacterAnimation>
  profile: PlayerProfile
  speedRef?: MutableRefObject<number>
  walkSpeed?: number
  headTiltRef?: MutableRefObject<number>
  headYawRef?: MutableRefObject<number>
  stretchRef?: MutableRefObject<number>
  pettingRef?: MutableRefObject<boolean>
  talkingRef?: MutableRefObject<boolean>
  movementRef?: MutableRefObject<PlayerMovement>
  footfallRef?: MutableRefObject<number>
  gaitStyle?: GaitStyle
  expressionPhase?: number
  blinkSeed?: number
}) {
  return (
    <ProceduralCharacter
      profile={profile}
      animationRef={animationRef}
      speedRef={speedRef}
      walkSpeed={walkSpeed}
      headTiltRef={headTiltRef}
      headYawRef={headYawRef}
      stretchRef={stretchRef}
      pettingRef={pettingRef}
      talkingRef={talkingRef}
      movementRef={movementRef}
      footfallRef={footfallRef}
      gaitStyle={gaitStyle}
      expressionPhase={expressionPhase}
      blinkSeed={blinkSeed}
    />
  )
}
