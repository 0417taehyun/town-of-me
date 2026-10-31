import { useFrame, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Group, type Vector3 } from 'three'
import type { TownObject } from '../../../data/models'
import type { WorldActor } from '../../motion/npcMotion'
import type { TownLayerProps } from '../townObjectKind'
import { easeVegetationBend, setVegetationTarget } from '../vegetationMotion'
import { cloneNatureModel } from './natureMaterials'
import { getNaturePropLayout, naturePropFiles, type NaturePropKind } from './naturePropLayout'

const NATURE = '/assets/kenney/nature/'

export function NatureAsset({
  file,
  tint,
  ...props
}: {
  file: string
  tint?: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}) {
  // Plain GLTFLoader: the props are uncompressed, so drei's Draco and Meshopt decoders would only weigh the bundle.
  const { scene } = useLoader(GLTFLoader, `${NATURE}${file}`)
  const { model, materials } = useMemo(() => cloneNatureModel(scene, tint), [scene, tint])
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])
  return <primitive object={model} {...props} />
}

export const NatureProp = memo(function NatureProp({
  object,
  playerPosition,
  actors,
  reducedMotion,
}: {
  object: TownObject
  playerPosition: MutableRefObject<Vector3>
  actors: MutableRefObject<WorldActor[]>
  reducedMotion: boolean
}) {
  const layout = getNaturePropLayout(object.type as NaturePropKind, object.scale)
  const position: [number, number, number] = [object.position.x, object.position.y, object.position.z]
  const visual = useRef<Group>(null)
  const bend = useRef({ x: 0, z: 0 })
  const target = useRef({ x: 0, z: 0 })
  useFrame(({ clock }, delta) => {
    if (!layout.reactive || !visual.current) return
    setVegetationTarget(
      position[0],
      position[2],
      playerPosition.current,
      actors.current,
      clock.elapsedTime,
      reducedMotion ? 0.35 : 1,
      target.current,
    )
    easeVegetationBend(bend.current, target.current, delta)
    visual.current.rotation.set(bend.current.x, 0, bend.current.z)
  })
  const visualAsset = (
    <group ref={visual}>
      <NatureAsset
        file={layout.file}
        tint={object.color}
        position={[0, layout.groundOffset, 0]}
        rotation={[0, object.rotation, 0]}
        scale={layout.scale}
      />
    </group>
  )
  return <group position={position}>{visualAsset}</group>
})

/** Rocks, bushes, mushrooms, and pumpkins, each its own model. */
export function NaturePropsLayer({ objects, scene }: { objects: TownObject[]; scene: TownLayerProps }) {
  return (
    <>
      {objects.map((object) => (
        <NatureProp
          key={object.id}
          object={object}
          playerPosition={scene.playerPosition}
          actors={scene.actors}
          reducedMotion={scene.reducedMotion}
        />
      ))}
    </>
  )
}

naturePropFiles.forEach((file) => useLoader.preload(GLTFLoader, `${NATURE}${file}`))
