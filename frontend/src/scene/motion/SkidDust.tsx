import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { DynamicDrawUsage, InstancedMesh } from 'three'
import { drawDustPuff, DUST_CAPACITY, HIDDEN_PUFF, type DustCloud } from './dustCloud'

export function SkidDust({ cloud }: { cloud: MutableRefObject<DustCloud> }) {
  const mesh = useRef<InstancedMesh>(null)
  const indices = useMemo(() => Array.from({ length: DUST_CAPACITY }, (_, index) => index), [])

  useLayoutEffect(() => {
    mesh.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    indices.forEach((index) => mesh.current?.setMatrixAt(index, HIDDEN_PUFF))
  }, [indices])

  useFrame((_, rawDelta) => {
    const target = mesh.current
    const { particles } = cloud.current
    if (!target || !particles.some(Boolean)) return
    const delta = Math.min(rawDelta, 0.05)
    particles.forEach((_, index) => drawDustPuff(target, cloud.current, index, delta))
    target.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, DUST_CAPACITY]} frustumCulled={false}>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#f1e7d2" roughness={1} flatShading />
    </instancedMesh>
  )
}
