import { memo } from 'react'
import { AdditiveBlending } from 'three'
import type { TownObject } from '../../../data/models'
import { getGlowTexture } from '../../glowTexture'
import { GroundGlow } from '../GroundGlow'
import type { TownLayerProps } from '../townObjectKind'

export const Lamp = memo(function Lamp({ object, lampsOn }: { object: TownObject; lampsOn: boolean }) {
  const { x, y, z } = object.position
  const metal = object.color ?? '#485b57'
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 1.35, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.14, 2.7, 12]} />
        <meshStandardMaterial color={metal} />
      </mesh>
      <mesh position={[0, 2.78, 0]} castShadow>
        <dodecahedronGeometry args={[0.37, 1]} />
        <meshStandardMaterial
          color={lampsOn ? '#fff1b7' : '#cedbd5'}
          emissive="#ffdc75"
          emissiveIntensity={lampsOn ? 1.6 : 0}
        />
      </mesh>
      <mesh position={[0, 3.05, 0]}>
        <coneGeometry args={[0.46, 0.32, 12]} />
        <meshStandardMaterial color={metal} />
      </mesh>
      {lampsOn && (
        <>
          <sprite position={[0, 2.78, 0]} scale={2.6}>
            <spriteMaterial
              map={getGlowTexture()}
              color="#ffd27f"
              transparent
              opacity={0.6}
              blending={AdditiveBlending}
              depthWrite={false}
              fog={false}
              toneMapped={false}
            />
          </sprite>
          <GroundGlow position={[0, 0.09, 0]} size={[6.5, 6.5]} color="#ffc46e" opacity={0.4} />
        </>
      )}
    </group>
  )
})

export function LampsLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  return (
    <>
      {objects.map((object) => (
        <Lamp key={object.id} object={object} lampsOn={scene.lampsOn} />
      ))}
    </>
  )
}
