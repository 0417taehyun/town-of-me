import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import type { Group, Mesh, Vector3 } from 'three'
import type { TownGuideStep, TownSnapshot } from '../data/models'
import { getGuideBench } from '../data/townGuide'
import type { WorldActor } from './motion/npcMotion'

export function TownGuideMarker({
  step,
  town,
  actors,
  playerPosition,
}: {
  step: TownGuideStep
  town: TownSnapshot
  actors: MutableRefObject<WorldActor[]>
  playerPosition: MutableRefObject<Vector3>
}) {
  const marker = useRef<Group>(null)
  const benchPath = useRef<Mesh>(null)
  const benchTarget = useRef<Mesh>(null)
  const bench = useMemo(() => getGuideBench(town), [town])
  const guestbook = useMemo(() => town.objects.find(({ type }) => type === 'guestbook')?.position, [town.objects])

  useFrame(({ clock }) => {
    const group = marker.current
    const path = benchPath.current
    const targetRing = benchTarget.current
    if (!group || !path || !targetRing) return
    const pet = actors.current.find(({ id }) => id === 'pet')
    group.visible = step === 'pet' && Boolean(pet)
    if (pet) {
      group.position.set(
        pet.position.x,
        pet.position.y + 3.6 + Math.sin(clock.elapsedTime * 3.2) * 0.16,
        pet.position.z,
      )
      group.rotation.y = clock.elapsedTime * 0.8
    }

    const target = step === 'bench' ? bench?.position : step === 'guestbook' ? guestbook : null
    path.visible = Boolean(target)
    targetRing.visible = Boolean(target)
    if (!target) return
    const differenceX = target.x - playerPosition.current.x
    const differenceZ = target.z - playerPosition.current.z
    const distance = Math.hypot(differenceX, differenceZ)
    path.position.set(playerPosition.current.x + differenceX / 2, 0.045, playerPosition.current.z + differenceZ / 2)
    path.rotation.y = Math.atan2(differenceX, differenceZ)
    path.scale.z = distance
    targetRing.position.set(target.x, 0.06, target.z)
    const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.1
    targetRing.scale.setScalar(pulse)
  })

  return (
    <>
      <mesh ref={benchPath} visible={false} renderOrder={3}>
        <boxGeometry args={[0.14, 0.025, 1]} />
        <meshBasicMaterial color="#ffe07a" transparent opacity={0.78} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={benchTarget} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[1.25, 1.55, 32]} />
        <meshBasicMaterial color="#fff0a6" transparent opacity={0.86} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={marker} visible={false}>
        <mesh rotation={[0, 0, Math.PI]} castShadow>
          <coneGeometry args={[0.42, 0.88, 16]} />
          <meshStandardMaterial color="#ffd75e" emissive="#d98a24" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 0.63, 0]}>
          <torusGeometry args={[0.48, 0.1, 8, 24]} />
          <meshBasicMaterial color="#fff4b8" toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}
