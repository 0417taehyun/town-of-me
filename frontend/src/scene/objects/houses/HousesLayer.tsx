import { memo } from 'react'
import type { MutableRefObject } from 'react'
import type { Vector3 } from 'three'
import type { TownObject } from '../../../data/models'
import type { SeasonChange } from '../../environment/seasonTransition'
import { getRoundedBox } from '../../roundedBox'
import { GroundGlow } from '../GroundGlow'
import type { TownLayerProps } from '../townObjectKind'
import { getHouseTitle, HOUSE_DOOR_POSITION, HOUSE_MAILBOX_POSITION, HOUSE_STEP_POSITION } from './houseLayout'
import { HouseMailbox } from './HouseMailbox'
import { RoofSnow } from './RoofSnow'

export function HouseWindow({ x, lampsOn }: { x: number; lampsOn: boolean }) {
  return (
    <mesh position={[x, 1.8, 2.29]}>
      <primitive object={getRoundedBox(1.15, 1.05, 0.1, 0.04)} attach="geometry" />
      <meshStandardMaterial
        color={lampsOn ? '#f5d695' : '#bce1df'}
        emissive="#ffce7e"
        emissiveIntensity={lampsOn ? 0.7 : 0}
      />
    </mesh>
  )
}

export const House = memo(function House({
  object,
  lampsOn,
  playerPosition,
  snowy,
  seasonChange,
}: {
  object: TownObject
  lampsOn: boolean
  playerPosition: MutableRefObject<Vector3>
  /** Whether snow gathers on this roof in winter. */
  snowy: boolean
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const { x, y, z } = object.position
  return (
    <group position={[x, y, z]} rotation={[0, object.rotation, 0]}>
      <mesh position={[0, 1.55, 0]} castShadow receiveShadow>
        <primitive object={getRoundedBox(5.4, 3.1, 4.5, 0.18)} attach="geometry" />
        <meshStandardMaterial color={object.color ?? '#e7aa58'} roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.04, 0]} scale={[3.35, 1.4, 2.85]} castShadow>
        <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#704f4a" roughness={0.95} />
      </mesh>
      {snowy && (
        <RoofSnow seasonChange={seasonChange} height={4.1}>
          <mesh position={[-0.65, 4.24, 0.05]} scale={[2.25, 0.22, 1.75]} castShadow receiveShadow>
            <sphereGeometry args={[1, 18, 9]} />
            <meshStandardMaterial color="#f4fbff" roughness={1} />
          </mesh>
          <mesh position={[1.12, 4.1, -0.28]} scale={[1.38, 0.18, 1.16]} castShadow receiveShadow>
            <sphereGeometry args={[1, 16, 8]} />
            <meshStandardMaterial color="#e7f2f3" roughness={1} />
          </mesh>
        </RoofSnow>
      )}
      <mesh position={HOUSE_DOOR_POSITION}>
        <primitive object={getRoundedBox(1.15, 1.8, 0.12, 0.045)} attach="geometry" />
        <meshStandardMaterial color="#f1d7ad" />
      </mesh>
      <mesh position={HOUSE_STEP_POSITION} castShadow receiveShadow>
        <primitive object={getRoundedBox(1.6, 0.24, 0.65, 0.1)} attach="geometry" />
        <meshStandardMaterial color="#c9ad82" roughness={1} />
      </mesh>
      <HouseWindow x={-1.55} lampsOn={lampsOn} />
      <HouseWindow x={1.55} lampsOn={lampsOn} />
      {lampsOn &&
        [-1.55, 1.55].map((windowX) => (
          // Centered at the wall, so the brightest part of the spill falls right below the window.
          <GroundGlow key={windowX} position={[windowX, 0.06, 2.3]} size={[2.4, 3.4]} color="#ffb85c" opacity={0.3} />
        ))}
      <HouseMailbox
        owner={getHouseTitle(object)}
        linkedInProfileUrl={object.linkedInProfileUrl}
        position={HOUSE_MAILBOX_POSITION}
        playerPosition={playerPosition}
      />
    </group>
  )
})

/** Every other house gathers roof snow in winter. */
export function HousesLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  return (
    <>
      {objects.map((object, index) => (
        <House
          key={object.id}
          object={object}
          lampsOn={scene.lampsOn}
          playerPosition={scene.playerPosition}
          snowy={index % 2 === 0}
          seasonChange={scene.seasonChange}
        />
      ))}
    </>
  )
}
