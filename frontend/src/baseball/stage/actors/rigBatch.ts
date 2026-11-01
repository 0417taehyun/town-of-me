import { type BufferGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, type Object3D } from 'three'

// Many rigs drawn as a few instanced meshes: every part the rigs share a geometry for (a torso, a thigh, a glove) is
// one instanced mesh, its instances copied from the posed parts each frame, while the parts themselves stay hidden.
// Each baked head is a geometry of its own and a vertex-colored material, so it draws as itself.

/** One instanced mesh per shared geometry, and the hidden rig parts whose places and colors it draws. */
export type RigBatch = { group: Group; material: MeshStandardMaterial; slots: { mesh: InstancedMesh; parts: Mesh[] }[] }

/** A part drawn in the batch: a mesh in one plain color, not a baked head. */
export function isBatched(object: Object3D): object is Mesh<BufferGeometry, MeshStandardMaterial> {
  return object instanceof Mesh && object.material instanceof MeshStandardMaterial && !object.material.vertexColors
}

export function batchRigs(roots: readonly Object3D[]): RigBatch {
  const objects: Object3D[] = []
  roots.forEach((root) => root.traverse((object) => objects.push(object)))
  const parts = objects.filter(isBatched)
  const geometries = [...new Set(parts.map((part) => part.geometry))]
  const material = new MeshStandardMaterial({ roughness: 1 })
  const group = new Group()
  const slots = geometries.map((geometry) => {
    const shared = parts.filter((part) => part.geometry === geometry)
    const mesh = new InstancedMesh(geometry, material, shared.length)
    shared.forEach((part, index) => mesh.setColorAt(index, part.material.color))
    mesh.castShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
    return { mesh, parts: shared }
  })
  parts.forEach((part) => {
    part.visible = false
  })
  return { group, material, slots }
}

/** Copies every batched part's place, as `roots` were last posed, into its instance. */
export function drawRigBatch(batch: RigBatch, roots: readonly Object3D[]) {
  roots.forEach((root) => root.updateMatrixWorld(true))
  batch.slots.forEach(({ mesh, parts }) => {
    parts.forEach((part, index) => mesh.setMatrixAt(index, part.matrixWorld))
    mesh.instanceMatrix.needsUpdate = true
  })
}

/** Frees the instances and the shared material; the geometry stays with the rigs that share it. */
export function disposeRigBatch(batch: RigBatch) {
  batch.slots.forEach(({ mesh }) => mesh.dispose())
  batch.material.dispose()
}
