import { useLayoutEffect, useRef, type Ref } from 'react'
import { Object3D, type InstancedMesh } from 'three'
import {
  CHARACTER_SHADOW_OPACITY,
  CONTACT_SHADOW_COLOR,
  CONTACT_SHADOW_GROUND_Y,
  CONTACT_SHADOW_RENDER_ORDER,
  contactShadowTexture,
  OBJECT_SHADOW_OPACITY,
  type ContactShadowMesh,
  type ContactShadowPatch,
} from './contactShadow'

const patchTransform = new Object3D()

export function ContactShadowMaterial({ opacity }: { opacity: number }) {
  return (
    <meshBasicMaterial
      map={contactShadowTexture}
      color={CONTACT_SHADOW_COLOR}
      opacity={opacity}
      transparent
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-2}
      polygonOffsetUnits={-2}
    />
  )
}

/** A soft dark blob laid on the ground under a character; its owner fades it each frame with `fadeContactShadow`. */
export function ContactShadowBlob({
  ref,
  width,
  depth,
}: {
  ref: Ref<ContactShadowMesh>
  width: number
  depth: number
}) {
  return (
    <mesh
      ref={ref}
      position-y={CONTACT_SHADOW_GROUND_Y}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={CONTACT_SHADOW_RENDER_ORDER}
    >
      <planeGeometry args={[width, depth]} />
      <ContactShadowMaterial opacity={CHARACTER_SHADOW_OPACITY} />
    </mesh>
  )
}

/** Soft dark patches where objects meet the ground, all in one instanced mesh. */
export function ContactShadows({ patches }: { patches: ContactShadowPatch[] }) {
  const mesh = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const instances = mesh.current
    if (!instances) return
    patches.forEach((patch, index) => {
      patchTransform.position.set(patch.x, CONTACT_SHADOW_GROUND_Y, patch.z)
      patchTransform.rotation.set(-Math.PI / 2, patch.rotation, 0, 'YXZ')
      patchTransform.scale.set(patch.width, patch.depth, 1)
      patchTransform.updateMatrix()
      instances.setMatrixAt(index, patchTransform.matrix)
    })
    instances.instanceMatrix.needsUpdate = true
    instances.computeBoundingSphere()
  }, [patches])

  if (patches.length === 0) return null
  return (
    <instancedMesh
      key={patches.length}
      ref={mesh}
      args={[undefined, undefined, patches.length]}
      renderOrder={CONTACT_SHADOW_RENDER_ORDER}
    >
      <planeGeometry />
      <ContactShadowMaterial opacity={OBJECT_SHADOW_OPACITY} />
    </instancedMesh>
  )
}
