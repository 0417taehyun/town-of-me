import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { DynamicDrawUsage, InstancedMesh } from 'three'
import { seasonClock } from '../environment/seasonTransition'
import { drawSkidMark, HIDDEN_MARK, SKID_MARK_CAPACITY, SKID_MARK_COLORS, type SkidMarkTrail } from './skidMarkTrail'

export function SkidMarks({ trailRef }: { trailRef: MutableRefObject<SkidMarkTrail> }) {
  const mesh = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const target = mesh.current
    if (!target) return
    target.instanceMatrix.setUsage(DynamicDrawUsage)
    trailRef.current.marks.forEach((_, index) => target.setMatrixAt(index, HIDDEN_MARK))
    target.setColorAt(0, SKID_MARK_COLORS.path)
  }, [trailRef])

  useFrame(() => {
    const target = mesh.current
    const { marks } = trailRef.current
    if (!target || (!trailRef.current.changed && !marks.some(Boolean))) return
    const now = seasonClock()
    marks.forEach((_, index) => drawSkidMark(target, marks, index, now))
    trailRef.current.changed = false
    target.instanceMatrix.needsUpdate = true
    if (target.instanceColor) target.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SKID_MARK_CAPACITY]} frustumCulled={false} receiveShadow>
      <sphereGeometry args={[1, 8, 4]} />
      <meshStandardMaterial roughness={1} polygonOffset polygonOffsetFactor={-2} />
    </instancedMesh>
  )
}
