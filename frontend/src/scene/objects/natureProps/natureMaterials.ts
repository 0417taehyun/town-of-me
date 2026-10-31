import { Color, type Mesh, type MeshStandardMaterial, type Object3D } from 'three'

/**
 * Gives each mesh of a cloned model its own material. Kenney's nature models ship fully metallic, which renders
 * nearly black without an environment map, so the copies are made non-metal. A tint multiplies the model's own
 * colors so multi-colored models keep their shading and detail.
 */
export function prepareNatureMaterials(root: Object3D, tint?: string) {
  const tintColor = new Color(tint ?? '#ffffff')
  return root.getObjectsByProperty('isMesh', true).map((mesh) => giveTintedNonMetalMaterial(mesh as Mesh, tintColor))
}

export function giveTintedNonMetalMaterial(mesh: Mesh, tintColor: Color) {
  const material = (mesh.material as MeshStandardMaterial).clone()
  material.metalness = 0
  material.color.multiply(tintColor)
  mesh.material = material
  return material
}

export function castAndReceiveShadows(object: Object3D) {
  object.castShadow = true
  object.receiveShadow = true
}

/** A shadowed copy of a loaded model with its own tinted materials, so the loaded model stays untouched. */
export function cloneNatureModel(scene: Object3D, tint?: string) {
  const model = scene.clone()
  model.traverse(castAndReceiveShadows)
  return { model, materials: prepareNatureMaterials(model, tint) }
}
