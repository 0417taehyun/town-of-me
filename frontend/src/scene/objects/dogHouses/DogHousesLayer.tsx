import { memo } from 'react'
import type { MutableRefObject } from 'react'
import type { Vector3 } from 'three'
import type { TownObject } from '../../../data/models'
import { languageCopy } from '../../../i18n/language'
import type { SeasonChange } from '../../environment/seasonTransition'
import { getRoundedBox } from '../../roundedBox'
import { HouseMailbox } from '../houses/HouseMailbox'
import { RoofSnow } from '../houses/RoofSnow'
import type { TownLayerProps } from '../townObjectKind'

export const DogHouse = memo(function DogHouse({
  object,
  title,
  playerPosition,
  seasonChange,
}: {
  object: TownObject
  /** The mailbox title, such as the pet's house in the visitor's language. */
  title: string
  playerPosition: MutableRefObject<Vector3>
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const { x, y, z } = object.position
  return (
    <group position={[x, y, z]} rotation={[0, object.rotation, 0]}>
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <primitive object={getRoundedBox(2.35, 1.55, 1.8, 0.18)} attach="geometry" />
        <meshStandardMaterial color={object.color ?? '#d88a43'} roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.52, 0]} scale={[1.55, 0.72, 1.3]} castShadow>
        <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#704f4a" roughness={1} />
      </mesh>
      <RoofSnow seasonChange={seasonChange} height={2.1}>
        <mesh position={[-0.18, 2.16, 0]} scale={[1.08, 0.13, 0.84]} castShadow receiveShadow>
          <sphereGeometry args={[1, 16, 8]} />
          <meshStandardMaterial color="#f4fbff" roughness={1} />
        </mesh>
      </RoofSnow>
      <mesh position={[0, 0.76, 0.91]}>
        <circleGeometry args={[0.48, 24]} />
        <meshStandardMaterial color="#3f3029" roughness={1} />
      </mesh>
      <mesh position={[0, 0.35, 0.92]}>
        <primitive object={getRoundedBox(0.96, 0.7, 0.08, 0.08)} attach="geometry" />
        <meshStandardMaterial color="#3f3029" roughness={1} />
      </mesh>
      <group position={[0, 1.22, 0.98]} rotation={[0, 0, -0.12]}>
        <mesh scale={[0.42, 0.1, 0.08]}>
          <sphereGeometry args={[1, 14, 10]} />
          <meshStandardMaterial color="#fff0d2" />
        </mesh>
        {[-0.4, 0.4].map((boneX) => (
          <mesh key={boneX} position={[boneX, 0, 0]} scale={[0.15, 0.18, 0.1]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshStandardMaterial color="#fff0d2" />
          </mesh>
        ))}
      </group>
      <HouseMailbox owner={title} position={[-1.65, 0, 1.05]} playerPosition={playerPosition} scale={0.72} />
    </group>
  )
})

export function DogHousesLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  const title = languageCopy[scene.language].pet.house(scene.petName)
  return (
    <>
      {objects.map((object) => (
        <DogHouse
          key={object.id}
          object={object}
          title={title}
          playerPosition={scene.playerPosition}
          seasonChange={scene.seasonChange}
        />
      ))}
    </>
  )
}
