import { useEffect, useMemo } from 'react'
import type { BallparkPalette } from '../../scene/venues/ballpark/ballparkThemes'
import type { VenueMaterials } from '../../scene/venues/venueMaterials'
import { createShedGeometries } from './landmarkLayout'

/**
 * The two dugouts as garden sheds in the ballpark's building colors, so an admin's walls, roof, trim, and accent show
 * here; their round windows keep their glass.
 */
export function Dugouts({ materials }: { materials: VenueMaterials<keyof BallparkPalette> }) {
  const sheds = useMemo(() => createShedGeometries(), [])
  useEffect(() => () => Object.values(sheds).forEach((geometry) => geometry.dispose()), [sheds])
  return (
    <group>
      <mesh geometry={sheds.walls} material={materials.walls} castShadow receiveShadow />
      <mesh geometry={sheds.roof} material={materials.roof} castShadow receiveShadow />
      <mesh geometry={sheds.trim} material={materials.trim} castShadow receiveShadow />
      <mesh geometry={sheds.accent} material={materials.accent} castShadow receiveShadow />
      <mesh geometry={sheds.glass}>
        <meshStandardMaterial color="#425566" roughness={0.4} />
      </mesh>
    </group>
  )
}
