import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { DynamicDrawUsage, InstancedMesh, Object3D, type Vector3 } from 'three'
import type { TownObject } from '../../../data/models'
import type { SeasonChange } from '../../environment/seasonTransition'
import { markInstancesUpdated, setInstanceColors } from '../../instancedMeshes'
import type { WorldActor } from '../../motion/npcMotion'
import type { TownLayerProps } from '../townObjectKind'
import { easeVegetationBend, setVegetationTarget } from '../vegetationMotion'
import { fadeWeedColors, setWeedMatrices, WEED_BLADE_COUNT, weedColorsOf, type WeedFade } from './weedInstances'

export function InstancedWeeds({
  objects,
  seasonChange,
  playerPosition,
  actors,
  reducedMotion,
}: {
  objects: TownObject[]
  seasonChange: MutableRefObject<SeasonChange>
  playerPosition: MutableRefObject<Vector3>
  actors: MutableRefObject<WorldActor[]>
  reducedMotion: boolean
}) {
  const blades = useRef<InstancedMesh>(null)
  const bladeCount = objects.length * WEED_BLADE_COUNT
  const dummy = useMemo(() => new Object3D(), [])
  const bends = useMemo(() => objects.map(() => ({ x: 0, z: 0 })), [objects])
  const targets = useMemo(() => objects.map(() => ({ x: 0, z: 0 })), [objects])
  const fade = useRef<WeedFade | null>(null)

  useLayoutEffect(() => {
    setInstanceColors(blades.current, weedColorsOf(objects, seasonChange.current.to))
    blades.current?.instanceMatrix.setUsage(DynamicDrawUsage)
    setWeedMatrices(objects, bends, dummy, blades.current)
    markInstancesUpdated(blades.current)
    fade.current = null
  }, [bends, dummy, objects, seasonChange])

  useFrame(({ clock }, delta) => {
    const motionScale = reducedMotion ? 0.35 : 1
    objects.forEach((object, index) => {
      setVegetationTarget(
        object.position.x,
        object.position.z,
        playerPosition.current,
        actors.current,
        clock.elapsedTime,
        motionScale,
        targets[index],
      )
      easeVegetationBend(bends[index], targets[index], delta)
    })
    setWeedMatrices(objects, bends, dummy, blades.current)
    fadeWeedColors(blades.current, fade, objects, seasonChange.current)
    // Colors upload only while they fade; the blades' matrices change every frame.
    if (blades.current) blades.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={blades} args={[undefined, undefined, Math.max(1, bladeCount)]} count={bladeCount}>
      <coneGeometry args={[1, 2, 5, 1]} />
      <meshStandardMaterial roughness={1} />
    </instancedMesh>
  )
}

export function WeedsLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  return (
    <InstancedWeeds
      objects={objects}
      seasonChange={scene.seasonChange}
      playerPosition={scene.playerPosition}
      actors={scene.actors}
      reducedMotion={scene.reducedMotion}
    />
  )
}
