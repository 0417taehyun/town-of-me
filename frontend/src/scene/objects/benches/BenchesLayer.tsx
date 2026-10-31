import { memo, useLayoutEffect, useRef } from 'react'
import type { InstancedMesh } from 'three'
import type { TownObject } from '../../../data/models'
import { writeBoxParts, type BoxPart } from '../../instancedMeshes'
import { BENCH_SURFACE_HEIGHT, getBenchLayout } from '../../motion/characterPose'
import { getRoundedBox } from '../../roundedBox'

export const Bench = memo(function Bench({ object }: { object: TownObject }) {
  const { x, y, z } = object.position
  const layout = getBenchLayout(object)
  const wood = useRef<InstancedMesh>(null)
  const metal = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const woodParts: BoxPart[] = [
      [0, BENCH_SURFACE_HEIGHT - 0.08, 0, layout.width, 0.16, layout.depth],
      [0, 1.02, -0.5, layout.width, 0.24, 0.14],
      [0, 1.38, -0.5, layout.width, 0.24, 0.14],
    ]
    const metalParts = [-1, 1].flatMap((side): BoxPart[] => [
      [side * (layout.width / 2 - 0.2), 0.29, 0.3, 0.15, 0.58, 0.15],
      [side * (layout.width / 2 - 0.2), 0.74, -0.4, 0.15, 1.48, 0.15],
    ])
    writeBoxParts(wood.current, woodParts)
    writeBoxParts(metal.current, metalParts)
  }, [layout.width, layout.depth])
  return (
    <group position={[x, y, z]} rotation={[0, layout.rotation, 0]}>
      <instancedMesh ref={wood} args={[undefined, undefined, 3]} castShadow receiveShadow>
        <primitive object={getRoundedBox(1, 1, 1, 0.16)} attach="geometry" />
        <meshStandardMaterial color={object.color ?? '#a5774e'} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={metal} args={[undefined, undefined, 4]} castShadow>
        <primitive object={getRoundedBox(1, 1, 1, 0.18)} attach="geometry" />
        <meshStandardMaterial color="#53645d" roughness={1} />
      </instancedMesh>
    </group>
  )
})

export function BenchesLayer({ objects }: { objects: TownObject[] }) {
  return (
    <>
      {objects.map((object) => (
        <Bench key={object.id} object={object} />
      ))}
    </>
  )
}
