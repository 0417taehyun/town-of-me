import { AdditiveBlending } from 'three'
import { getGlowTexture } from '../../glowTexture'

/** Painted halos, one soft glow per point, `size` m across. */
export function Halos({ positions, size }: { positions: Float32Array; size: number }) {
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={getGlowTexture()}
        color="#ffd896"
        size={size}
        transparent
        opacity={0.75}
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}
