import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Color, InstancedMesh, Object3D } from 'three'
import type { TownObject } from '../../../data/models'
import {
  getSnowCover,
  isSeasonChangeSettled,
  seasonClock,
  toLinearColors,
  type SeasonChange,
} from '../../environment/seasonTransition'
import { setInstanceColors } from '../../instancedMeshes'
import { foliageMaterial, updateFoliageSway } from '../foliageMaterial'
import type { TownLayerProps } from '../townObjectKind'
import { budColorOf, getPetalLayouts, setFlowerBloom, type FlowerMeshes } from './flowerInstances'
import { getFlowerLayout } from './flowerLayout'

export function InstancedFlowers({
  objects,
  seasonChange,
  reducedMotion,
}: {
  objects: TownObject[]
  seasonChange: MutableRefObject<SeasonChange>
  reducedMotion: boolean
}) {
  const stems = useRef<InstancedMesh>(null)
  const leaves = useRef<InstancedMesh>(null)
  const centers = useRef<InstancedMesh>(null)
  const petals = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const settledAt = useRef(Number.NaN)
  const layouts = useMemo(() => objects.map((object) => getFlowerLayout(object)), [objects])
  const petalLayouts = useMemo(() => getPetalLayouts(layouts), [layouts])
  const petalColors = useMemo(() => {
    const colors = petalLayouts.map(({ flowerIndex }) => layouts[flowerIndex].petalColor)
    return { from: toLinearColors(colors), to: toLinearColors(colors.map(budColorOf)) }
  }, [layouts, petalLayouts])

  useLayoutEffect(() => {
    const green = new Color('#269b4b')
    layouts.forEach((layout, index) => {
      stems.current?.setColorAt(index, green)
      leaves.current?.setColorAt(index, green)
      centers.current?.setColorAt(index, new Color(layout.centerColor))
    })
    setInstanceColors(petals.current, petalColors.from)
    const meshes: FlowerMeshes = [stems.current, leaves.current, centers.current, petals.current]
    const snowCover = getSnowCover(seasonChange.current, seasonClock())
    setFlowerBloom(layouts, petalLayouts, petalColors, dummy, meshes, snowCover)
    settledAt.current = Number.NaN
  }, [dummy, layouts, petalColors, petalLayouts, seasonChange])

  useFrame(({ clock }) => {
    updateFoliageSway(clock.elapsedTime, reducedMotion)
    const change = seasonChange.current
    if (settledAt.current === change.startedAt) return
    const now = seasonClock()
    const meshes: FlowerMeshes = [stems.current, leaves.current, centers.current, petals.current]
    setFlowerBloom(layouts, petalLayouts, petalColors, dummy, meshes, getSnowCover(change, now))
    if (isSeasonChangeSettled(change, now)) settledAt.current = change.startedAt
  })

  return (
    <group>
      <instancedMesh
        ref={stems}
        args={[undefined, foliageMaterial, Math.max(1, objects.length)]}
        count={objects.length}
      >
        <cylinderGeometry args={[1, 1, 2, 6]} />
      </instancedMesh>
      <instancedMesh
        ref={leaves}
        args={[undefined, foliageMaterial, Math.max(1, objects.length)]}
        count={objects.length}
      >
        <dodecahedronGeometry args={[1, 0]} />
      </instancedMesh>
      <instancedMesh
        ref={centers}
        args={[undefined, foliageMaterial, Math.max(1, objects.length)]}
        count={objects.length}
      >
        <sphereGeometry args={[1, 8, 6]} />
      </instancedMesh>
      <instancedMesh
        ref={petals}
        args={[undefined, foliageMaterial, Math.max(1, petalLayouts.length)]}
        count={petalLayouts.length}
      >
        <sphereGeometry args={[1, 8, 5]} />
      </instancedMesh>
    </group>
  )
}

export function FlowersLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  return <InstancedFlowers objects={objects} seasonChange={scene.seasonChange} reducedMotion={scene.reducedMotion} />
}
