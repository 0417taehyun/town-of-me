import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PlayerProfile } from '../data/playerProfile'
import type { AppLanguage } from '../i18n/language'
import { GraphicsCanvas } from '../scene/GraphicsCanvas'
import type { CharacterAnimation } from '../scene/characters/Characters'
import { ProceduralCharacter } from '../scene/characters/ProceduralCharacter'
import { BLINK_SECONDS, getSecondsUntilBlink } from '../scene/motion/playerMotion'

/** Enough frames to draw a blink at 60 Hz; one more frame after it always leaves the eyes open. */
const BLINK_FRAMES = 12

/** Draws an on-demand canvas through each of the character's idle blinks, which no prop change would redraw. */
export function BlinkFrames({ seed = 0 }: { seed?: number }) {
  const clock = useThree((state) => state.clock)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    let timer = 0
    const awaitBlink = () => {
      timer = window.setTimeout(drawBlink, getSecondsUntilBlink(clock.getElapsedTime(), seed) * 1000)
    }
    const drawBlink = () => {
      invalidate(BLINK_FRAMES)
      timer = window.setTimeout(
        () => {
          invalidate()
          awaitBlink()
        },
        BLINK_SECONDS * 1000 + 30,
      )
    }
    awaitBlink()
    return () => window.clearTimeout(timer)
  }, [clock, invalidate, seed])
  return null
}

/** A lit, front-facing view of one character, turned by `degrees`; it redraws when its props change and to blink. */
export function CharacterPreviewCanvas({
  language,
  profile,
  degrees,
}: {
  language: AppLanguage
  profile: PlayerProfile
  degrees: number
}) {
  const idle = useRef<CharacterAnimation>('idle')
  return (
    <GraphicsCanvas
      language={language}
      preview
      frameloop="demand"
      dpr={[1, 1.25]}
      camera={{ position: [0, 1.2, 5.2], fov: 32 }}
      onCreated={({ camera }) => camera.lookAt(0, 1.1, 0)}
    >
      <ambientLight intensity={1.7} />
      <directionalLight position={[3, 5, 4]} intensity={2.5} />
      <group position={[0, 0.87, 0]} rotation={[0, (degrees * Math.PI) / 180, 0]}>
        {/* The key-pose walk stands still as the preview turns; planted feet would step round and freeze mid-step. */}
        <ProceduralCharacter profile={profile} animationRef={idle} gaitStyle="keyPoses" />
      </group>
      <BlinkFrames />
    </GraphicsCanvas>
  )
}
