import { memo, useEffect, useMemo, useState } from 'react'
import type { TownObject } from '../../../data/models'
import type { AppLanguage } from '../../../i18n/language'
import { languageCopy } from '../../../i18n/language'
import { getRoundedBox } from '../../roundedBox'
import type { TownLayerProps } from '../townObjectKind'
import { drawSignTexture } from './signTexture'

const pinnedNotes = [
  { x: -1.15, y: 2.25, rotation: -0.06, color: '#fff3cf', pin: '#c85f50' },
  { x: 0, y: 2.4, rotation: 0.035, color: '#f7e5bd', pin: '#e3ae4c' },
  { x: 1.16, y: 2.18, rotation: 0.075, color: '#fff8df', pin: '#668f78' },
  { x: -0.62, y: 1.25, rotation: 0.04, color: '#f1ddb4', pin: '#6c87a0' },
  { x: 0.78, y: 1.2, rotation: -0.045, color: '#faedc8', pin: '#b66c77' },
] as const

/** The plaque's height in meters; its width follows the title. */
export const SIGN_HEIGHT = 0.7

/**
 * The board's name on a plaque standing on its top beam. It is part of the scene, so speech bubbles and the interface stay in
 * front of it and trees or characters can hide it, unlike an HTML label floating over everything.
 */
export function GuestbookSign({ title }: { title: string }) {
  const [fontsLoaded, setFontsLoaded] = useState(false)
  useEffect(() => {
    let active = true
    void document.fonts?.ready.then(() => active && setFontsLoaded(true))
    return () => {
      active = false
    }
  }, [])
  const sign = useMemo(() => drawSignTexture(title, fontsLoaded), [title, fontsLoaded])
  useEffect(() => () => sign.texture.dispose(), [sign])
  const width = SIGN_HEIGHT * sign.aspect
  return (
    <group position={[0, 3.7 + SIGN_HEIGHT / 2 + 0.04, 0]}>
      <mesh castShadow>
        <primitive object={getRoundedBox(width + 0.18, SIGN_HEIGHT + 0.18, 0.14, 0.06)} attach="geometry" />
        <meshStandardMaterial color="#704b37" roughness={1} />
      </mesh>
      {/* A faint glow of its own keeps the lettering readable once the sun is down. */}
      <mesh position={[0, 0, 0.075]}>
        <planeGeometry args={[width, SIGN_HEIGHT]} />
        <meshStandardMaterial
          map={sign.texture}
          emissiveMap={sign.texture}
          emissive="#ffffff"
          emissiveIntensity={0.18}
          transparent
          roughness={0.9}
        />
      </mesh>
    </group>
  )
}

export const GuestbookBoard = memo(function GuestbookBoard({
  object,
  language,
}: {
  object: TownObject
  language: AppLanguage
}) {
  const { x, y, z } = object.position
  const wood = object.color ?? '#9a6845'
  return (
    <group position={[x, y, z]} rotation={[0, object.rotation, 0]}>
      {[-1.85, 1.85].map((postX) => (
        <mesh key={postX} position={[postX, 1.35, -0.08]} castShadow receiveShadow>
          <primitive object={getRoundedBox(0.3, 2.7, 0.34, 0.09)} attach="geometry" />
          <meshStandardMaterial color="#76513b" roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, 2, 0]} castShadow receiveShadow>
        <primitive object={getRoundedBox(4.45, 2.7, 0.38, 0.18)} attach="geometry" />
        <meshStandardMaterial color={wood} roughness={1} />
      </mesh>
      <mesh position={[0, 2, 0.22]} receiveShadow>
        <primitive object={getRoundedBox(3.82, 2.16, 0.12, 0.12)} attach="geometry" />
        <meshStandardMaterial color="#6e4935" roughness={1} />
      </mesh>
      <mesh position={[0, 3.42, -0.02]} castShadow>
        <primitive object={getRoundedBox(4.8, 0.55, 0.62, 0.16)} attach="geometry" />
        <meshStandardMaterial color="#704b37" roughness={1} />
      </mesh>
      {pinnedNotes.map((note) => (
        <group key={`${note.x}-${note.y}`} position={[note.x, note.y, 0.34]} rotation={[0, 0, note.rotation]}>
          <mesh castShadow>
            <primitive object={getRoundedBox(0.92, 0.7, 0.035, 0.035)} attach="geometry" />
            <meshStandardMaterial color={note.color} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.27, 0.055]}>
            <sphereGeometry args={[0.075, 12, 8]} />
            <meshStandardMaterial color={note.pin} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <GuestbookSign title={languageCopy[language].guestbook.title} />
    </group>
  )
})

/** The town has one board; a second one in the data is not drawn. */
export function GuestbookLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  const [guestbook] = objects
  if (!guestbook) return null
  return <GuestbookBoard object={guestbook} language={scene.language} />
}
