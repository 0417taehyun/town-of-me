import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { DynamicDrawUsage, InstancedMesh, Object3D, type Vector3 } from 'three'
import { markInstancesUpdated } from '../instancedMeshes'
import { getSnowFootprintPlacement, type GroundPoint } from '../motion/playerMotion'
import { fadeFootprints, setFootprintMatrix, SNOW_FOOTPRINT_CAPACITY, type SnowFootprint } from './footprintMarks'
import { getSnowCover, seasonClock, type SeasonChange } from './seasonTransition'

/** The player leaves footprints wherever the snow lies thick enough to hold them. */
export function SnowFootprints({
  playerPosition,
  seasonChange,
}: {
  playerPosition: MutableRefObject<Vector3>
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const footprints = useRef<InstancedMesh>(null)
  const previous = useRef<GroundPoint | null>(null)
  const nextSide = useRef<-1 | 1>(-1)
  const activeFootprints = useRef<Array<SnowFootprint | null>>(
    Array.from({ length: SNOW_FOOTPRINT_CAPACITY }, () => null),
  )
  const dummy = useMemo(() => new Object3D(), [])

  useLayoutEffect(() => {
    dummy.position.set(0, -10, 0)
    dummy.updateMatrix()
    Array.from({ length: SNOW_FOOTPRINT_CAPACITY }, (_, index) => footprints.current?.setMatrixAt(index, dummy.matrix))
    footprints.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    markInstancesUpdated(footprints.current)
  }, [dummy])

  useFrame(({ clock }) => {
    const mesh = footprints.current
    if (!mesh) return
    fadeFootprints(activeFootprints.current, clock.elapsedTime, dummy, mesh)

    const current = { x: playerPosition.current.x, z: playerPosition.current.z }
    if (!previous.current) {
      previous.current = current
      return
    }
    const distance = Math.hypot(current.x - previous.current.x, current.z - previous.current.z)
    if (distance > 3 || getSnowCover(seasonChange.current, seasonClock()) < 0.6) {
      previous.current = current
      return
    }
    const placement = getSnowFootprintPlacement(previous.current, current, nextSide.current)
    if (!placement) return
    const availableIndex = activeFootprints.current.findIndex((footprint) => footprint === null)
    if (availableIndex < 0) {
      previous.current = current
      return
    }
    activeFootprints.current[availableIndex] = { ...placement, createdAt: clock.elapsedTime }
    setFootprintMatrix(mesh, dummy, availableIndex, placement, 1)
    mesh.instanceMatrix.needsUpdate = true
    nextSide.current = nextSide.current === -1 ? 1 : -1
    previous.current = current
  })

  return (
    <instancedMesh ref={footprints} args={[undefined, undefined, SNOW_FOOTPRINT_CAPACITY]} frustumCulled={false}>
      <sphereGeometry args={[1, 10, 6]} />
      <meshStandardMaterial color="#9fb4b8" roughness={1} />
    </instancedMesh>
  )
}
