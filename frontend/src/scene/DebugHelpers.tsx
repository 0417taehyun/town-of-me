import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Mesh, Vector3 } from 'three'
import type { MutableRefObject } from 'react'

export function Marker({
  source,
  color,
  height,
}: {
  source: MutableRefObject<Vector3>
  color: string
  height: number
}) {
  const mesh = useRef<Mesh>(null)
  useFrame(() => {
    mesh.current?.position.copy(source.current).setY(source.current.y + height)
  })
  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[0.16, 10, 8]} />
      <meshBasicMaterial color={color} depthTest={false} />
    </mesh>
  )
}

export function DebugHelpers({
  playerPosition,
  dampedTarget,
  lookAheadTarget,
}: {
  playerPosition: MutableRefObject<Vector3>
  dampedTarget: MutableRefObject<Vector3>
  lookAheadTarget: MutableRefObject<Vector3>
}) {
  return (
    <>
      <Marker source={playerPosition} color="#ff4f67" height={1.35} />
      <Marker source={dampedTarget} color="#4de8ff" height={0} />
      <Marker source={lookAheadTarget} color="#ffe34d" height={1.2} />
    </>
  )
}
