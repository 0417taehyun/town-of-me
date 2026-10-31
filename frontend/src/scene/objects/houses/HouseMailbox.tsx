import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState, type MutableRefObject } from 'react'
import { Group, Vector3, type Vector3Tuple } from 'three'
import { normalizeLinkedInProfileUrl } from '../../../data/linkedInProfile'
import { placeCurvedLabel, WORLD_LABEL_LAYERS } from '../../worldLabels'
import { getRoundedBox } from '../../roundedBox'

const mailboxWorldPosition = new Vector3()

export function HouseMailbox({
  owner,
  linkedInProfileUrl,
  position,
  playerPosition,
  scale = 1,
}: {
  owner: string
  linkedInProfileUrl?: string
  position: Vector3Tuple
  playerPosition: MutableRefObject<Vector3>
  scale?: number
}) {
  const mailbox = useRef<Group>(null)
  const nearby = useRef(false)
  const [labelVisible, setLabelVisible] = useState(false)
  const profileUrl = normalizeLinkedInProfileUrl(linkedInProfileUrl)

  useFrame(() => {
    if (!mailbox.current) return
    mailbox.current.getWorldPosition(mailboxWorldPosition)
    const nextNearby = mailboxWorldPosition.distanceToSquared(playerPosition.current) < 4.2 ** 2
    if (nextNearby === nearby.current) return
    nearby.current = nextNearby
    setLabelVisible(nextNearby)
  })

  return (
    <group ref={mailbox} position={position} scale={scale}>
      <mesh position={[0, 0.72, 0]} castShadow>
        <primitive object={getRoundedBox(0.18, 1.44, 0.18, 0.07)} attach="geometry" />
        <meshStandardMaterial color="#76513d" roughness={1} />
      </mesh>
      <mesh position={[0, 1.47, 0]} castShadow>
        <primitive object={getRoundedBox(1.08, 0.76, 0.82, 0.25)} attach="geometry" />
        <meshStandardMaterial color="#d86f5a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.47, 0.421]}>
        <circleGeometry args={[0.12, 18]} />
        <meshStandardMaterial color="#f2d49b" roughness={0.8} />
      </mesh>
      <group position={[0.63, 1.72, 0]}>
        <mesh position={[0, -0.2, 0]}>
          <primitive object={getRoundedBox(0.08, 0.58, 0.08, 0.025)} attach="geometry" />
          <meshStandardMaterial color="#8f433b" />
        </mesh>
        <mesh position={[0.18, 0.05, 0]}>
          <primitive object={getRoundedBox(0.38, 0.24, 0.07, 0.035)} attach="geometry" />
          <meshStandardMaterial color="#f2b65f" />
        </mesh>
      </group>
      {labelVisible && (
        <Html
          center
          calculatePosition={placeCurvedLabel}
          position={[0, 2.45, 0]}
          distanceFactor={10}
          zIndexRange={WORLD_LABEL_LAYERS}
          style={{ pointerEvents: 'auto' }}
        >
          <div className="mailbox-label">
            {profileUrl ? (
              <a href={profileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${owner} on LinkedIn`}>
                {owner} ↗
              </a>
            ) : (
              <strong>{owner}</strong>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}
