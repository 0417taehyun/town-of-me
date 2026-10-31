import { AdditiveBlending } from 'three'
import { getGlowTexture } from '../glowTexture'

/**
 * Warm light painted onto the ground instead of lit, so night scenes need no extra lights or bloom pass. It sits a
 * little above the ground and is drawn after it, adding light without hiding the snow or grass underneath.
 */
export function GroundGlow({
  position,
  size,
  color,
  opacity,
}: {
  position: [number, number, number]
  size: [number, number]
  color: string
  opacity: number
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial
        map={getGlowTexture()}
        color={color}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        toneMapped={false}
      />
    </mesh>
  )
}
