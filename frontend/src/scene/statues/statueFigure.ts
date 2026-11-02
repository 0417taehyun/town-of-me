import { Group, type Material, Mesh, Object3D } from 'three'
import type { PlayerProfile } from '../../data/playerProfile'
import { type AvatarPart, getAvatarAppearance } from '../characters/avatarAppearance'
import { CHARACTER_BODY, characterLegSolids, type BodySolid } from '../characters/characterBody'
import { characterGeometries } from '../characters/characterGeometries'
import { HIP_HEIGHT, HIP_WIDTH, SHIN_LENGTH, THIGH_LENGTH } from '../motion/walkCycle'
import { getRoundedBox } from '../roundedBox'

// The town character standing still, as plain three.js objects a statue or a portrait can pose and light: the same
// shapes and colors ProceduralCharacter.tsx draws, in its body space (feet at y 0, facing +z, 2.1 tall). Every mesh
// shares the town's cached geometry, so a figure frees only the materials it was painted with.

/** Paints one color of the figure; called once per color. */
export type FigurePaint = (color: string) => Material

/** Index 0 of a pair hangs at -x, the character's right side; index 1 at +x. */
export type StatueFigure = {
  root: Group
  body: Group
  head: Group
  arms: [Group, Group]
  legs: [Group, Group]
  materials: Material[]
}

/** How far below its shoulder pivot an arm's hand sits (town units). */
export const HAND_REACH = 0.38

export function figureMesh(geometry: Mesh['geometry'], material: Material, castShadow = true) {
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = castShadow
  return mesh
}

export function placeSolid(mesh: Mesh, solid: BodySolid) {
  mesh.position.copy(solid.center)
  return mesh
}

export function headPartMesh(part: AvatarPart, material: Material) {
  const mesh = figureMesh(characterGeometries[part.shape], material, Math.max(...part.scale) > 0.15)
  mesh.position.set(...part.position)
  mesh.scale.set(...part.scale)
  mesh.rotation.set(...(part.rotation ?? [0, 0, 0]))
  return mesh
}

/** A figure of `profile` whose colors `paint` turns into materials, each color once. */
export function createStatueFigure(profile: PlayerProfile, paint: FigurePaint): StatueFigure {
  const appearance = getAvatarAppearance(profile)
  const painted = new Map<string, Material>()
  const material = (color: string) => {
    const known = painted.get(color) ?? paint(color)
    painted.set(color, known)
    return known
  }
  const { torso, collar, armPivot, headHeight } = CHARACTER_BODY
  const root = new Group()
  const body = new Group()
  const torsoMesh = figureMesh(
    getRoundedBox(torso.width, torso.height, torso.depth, torso.rounding),
    material(appearance.top),
  )
  torsoMesh.position.y = torso.centerY
  body.add(torsoMesh)
  const collarSides = appearance.collar ? [-1, 1] : []
  collarSides.forEach((side) => {
    const point = figureMesh(
      getRoundedBox(collar.width, collar.height, collar.depth, collar.rounding),
      material(collar.color),
      false,
    )
    point.position.set(side * collar.x, collar.y, collar.z)
    point.rotation.z = side * collar.turn
    body.add(point)
  })
  const head = new Group()
  head.position.y = headHeight
  head.add(...appearance.headParts.map((part) => headPartMesh(part, material(part.color))))
  body.add(head)
  const sleeveLength = appearance.longSleeves ? 0.45 : 0.25
  const arms = [-1, 1].map((side) => {
    const arm = new Group()
    arm.position.set(side * armPivot.x, armPivot.y, 0)
    // The town's rest pose lets the arms hang a little away from the body.
    arm.rotation.z = side * 0.08
    const sleeve = figureMesh(getRoundedBox(0.2, sleeveLength, 0.27, 0.08), material(appearance.top))
    sleeve.position.y = -0.12
    const hand = figureMesh(characterGeometries.hand, material(appearance.skin))
    hand.position.y = -HAND_REACH
    arm.add(sleeve, hand)
    return arm
  }) as [Group, Group]
  const solids = characterLegSolids(appearance)
  const legs = [-1, 1].map((side) => {
    const leg = new Group()
    leg.position.set(side * HIP_WIDTH, HIP_HEIGHT, 0)
    const knee = new Group()
    knee.position.y = -THIGH_LENGTH
    const ankle = new Group()
    ankle.position.y = -SHIN_LENGTH
    const thigh = placeSolid(
      figureMesh(getRoundedBox(...solids.thigh.size, solids.thigh.rounding), material(appearance.bottom)),
      solids.thigh,
    )
    const shinColor = appearance.shorts ? appearance.skin : appearance.bottom
    const shin = placeSolid(
      figureMesh(getRoundedBox(...solids.shin.size, solids.shin.rounding), material(shinColor)),
      solids.shin,
    )
    const shoe = placeSolid(
      figureMesh(getRoundedBox(...solids.shoe.size, solids.shoe.rounding), material(appearance.shoes)),
      solids.shoe,
    )
    ankle.add(shoe)
    knee.add(shin, ankle)
    leg.add(thigh, knee)
    return leg
  }) as [Group, Group]
  body.add(...arms, ...legs)
  root.add(body)
  return { root, body, head, arms, legs, materials: [...new Set(painted.values())] }
}

/** Every geometry the figure draws with: the town's shared ones, which nothing built on the figure may free. */
export function figureGeometries(figure: Pick<StatueFigure, 'root'>) {
  const geometries = new Set<Mesh['geometry']>()
  figure.root.traverse((object: Object3D) => addMeshGeometry(object, geometries))
  return geometries
}

export function addMeshGeometry(object: Object3D, geometries: Set<Mesh['geometry']>) {
  if (object instanceof Mesh) geometries.add(object.geometry)
}
