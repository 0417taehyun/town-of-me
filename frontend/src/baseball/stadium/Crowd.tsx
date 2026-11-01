import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { type InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import type { PlayerProfile } from '../../data/playerProfile'
import { writeInstanceMatrices } from '../../scene/instancedMeshes'
import type { BallView } from '../stage/ballMeshes'
import { standSeats, terraceSeats } from './bowlLayout'
import {
  addCrowdShader,
  advanceCrowd,
  createCrowdUniforms,
  createFanGeometry,
  crowdCount,
  crowdSeats,
  setFanSeat,
  writeFanLooks,
} from './crowdLayout'
import { pickLooks } from './guestLooks'

/**
 * The fans in the stands and on the outfield terrace (crowdLayout.ts), looking like the town's visitors (`approved`
 * guestbook looks, then random ones): they follow `ballViewRef`'s ball and cheer as much as `cheer` asks; a `reduced`
 * tier draws half of them. Under reduced motion they raise their arms for a cheer but neither hop nor wave.
 */
export function Crowd({
  approved,
  ballViewRef,
  cheer,
  reduced,
  reducedMotion,
}: {
  approved: readonly PlayerProfile[]
  ballViewRef: MutableRefObject<BallView | null>
  cheer: number
  reduced: boolean
  reducedMotion: boolean
}) {
  const seats = useMemo(() => crowdSeats([...standSeats(), ...terraceSeats()]), [])
  const looks = useMemo(() => pickLooks(approved, seats.length, 17), [approved, seats.length])
  const geometry = useMemo(() => createFanGeometry(), [])
  const uniforms = useMemo(() => createCrowdUniforms(), [])
  const material = useMemo(() => {
    const fanMaterial = new MeshStandardMaterial({ roughness: 0.9 })
    fanMaterial.onBeforeCompile = (shader) => addCrowdShader(shader, uniforms)
    return fanMaterial
  }, [uniforms])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  const mesh = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    writeInstanceMatrices(mesh.current, new Object3D(), seats.length, (dummy, index) => setFanSeat(dummy, seats[index]))
  }, [seats])
  useLayoutEffect(() => {
    if (mesh.current) writeFanLooks(mesh.current, looks)
  }, [looks])
  useLayoutEffect(() => {
    if (mesh.current) mesh.current.count = crowdCount(seats.length, reduced)
  }, [seats.length, reduced])
  useFrame((_, delta) => advanceCrowd(uniforms, ballViewRef.current, cheer, reducedMotion ? 0 : delta, delta))
  return <instancedMesh ref={mesh} args={[geometry, material, seats.length]} frustumCulled={false} />
}
