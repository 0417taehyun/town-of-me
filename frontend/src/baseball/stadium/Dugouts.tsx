import { BoxGeometry } from 'three'
import type { BallparkPalette } from '../../scene/venues/ballpark/ballparkThemes'
import type { VenueMaterials } from '../../scene/venues/venueMaterials'
import { DUGOUT_PARTS, DUGOUT_SPOTS } from './fieldLayout'

const unitBox = new BoxGeometry(1, 1, 1)

/** The two dugouts, built in the ballpark's building colors, so an admin's walls, roof, trim, and accent show here. */
export function Dugouts({ materials }: { materials: VenueMaterials<keyof BallparkPalette> }) {
  return DUGOUT_SPOTS.map((spot, dugout) => (
    <group key={dugout} position={[spot.x, 0, spot.z]} rotation-y={spot.yaw}>
      {DUGOUT_PARTS.map((part, index) => (
        <mesh
          key={index}
          geometry={unitBox}
          material={materials[part.role]}
          position={part.center}
          rotation-x={part.tilt}
          scale={part.size}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  ))
}
