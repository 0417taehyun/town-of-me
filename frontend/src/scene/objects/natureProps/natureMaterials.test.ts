import { Color, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { prepareNatureMaterials } from './natureMaterials'

function modelWith(material: MeshStandardMaterial) {
  const model = new Group()
  model.add(new Mesh(new SphereGeometry(), material))
  return { model, mesh: model.children[0] as Mesh }
}

describe('nature model materials', () => {
  it('gives every clone its own non-metal material and leaves the loaded model untouched', () => {
    const loaded = new MeshStandardMaterial({ metalness: 1 })
    const { model, mesh } = modelWith(loaded)
    const [prepared] = prepareNatureMaterials(model)
    expect(mesh.material).toBe(prepared)
    expect(prepared).not.toBe(loaded)
    expect(prepared.metalness).toBe(0)
    expect(loaded.metalness).toBe(1)
  })

  it('multiplies a tint into the model color instead of replacing it', () => {
    const { model } = modelWith(new MeshStandardMaterial({ color: '#808080' }))
    const [prepared] = prepareNatureMaterials(model, '#ff0000')
    const expected = new Color('#808080').multiply(new Color('#ff0000'))
    expect(prepared.color.toArray()).toEqual(expected.toArray())
  })
})
