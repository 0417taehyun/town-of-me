import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// The garden ballpark's shared parts: shapes placed in a frame and merged into one geometry per material, the corgi
// topiary, and the flower-stem light towers. baseball/stadium/landmarkLayout.ts places them round the field.

export type Triple = readonly [number, number, number]

/** A shape placed in its landmark's frame: moved to `at`, turned by `turn` (XYZ radians), and scaled by `size`. */
export type PlacedPart = { geometry: BufferGeometry; at?: Triple; turn?: Triple; size?: Triple | number }

export function partMatrix({ at = [0, 0, 0], turn = [0, 0, 0], size = 1 }: Omit<PlacedPart, 'geometry'>) {
  const scale = typeof size === 'number' ? new Vector3(size, size, size) : new Vector3(...size)
  return new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(new Euler(...turn)), scale)
}

/** The parts as one geometry, each moved into place and then all by `frame`. */
export function mergeParts(parts: readonly PlacedPart[], frame = new Matrix4()) {
  // Some shapes come indexed and some not (rounded boxes); merged geometry must be all one or the other.
  const placed = parts.map((part) => unindexed(part.geometry).applyMatrix4(frame.clone().multiply(partMatrix(part))))
  return mergeGeometries(placed) ?? new BufferGeometry()
}

export function unindexed(geometry: BufferGeometry) {
  return geometry.index ? geometry.toNonIndexed() : geometry.clone()
}

/** Parts given in `frame`'s space, as parts in the world: their geometry carries the frame. */
export function placeInFrame(parts: readonly PlacedPart[], frame: Matrix4): PlacedPart[] {
  return parts.map((part) => ({
    geometry: part.geometry.clone().applyMatrix4(frame.clone().multiply(partMatrix(part))),
  }))
}

export const unitSphere = new SphereGeometry(1, 16, 12)
/** A sphere whose leaf or flower texture repeats round it, so a big topiary's leaves stay leaf-sized. */
export const leafySphere = scaleUvs(new SphereGeometry(1, 16, 12), 3, 2)
export const unitBox = new BoxGeometry(1, 1, 1)

export function sphere(at: Triple, size: Triple): PlacedPart {
  return { geometry: leafySphere, at, size }
}

export function scaleUvs(geometry: BufferGeometry, across: number, up: number) {
  const uvs = geometry.getAttribute('uv')
  Array.from({ length: uvs.count }, (_, index) => index).forEach((index) =>
    uvs.setXY(index, uvs.getX(index) * across, uvs.getY(index) * up),
  )
  return geometry
}

export function box(at: Triple, size: Triple): PlacedPart {
  return { geometry: unitBox, at, size }
}

/**
 * A loafing corgi grown in orange and cream flowers on a hedge plinth, facing +z and about 6 m tall at scale 1: its
 * parts by what they are planted in.
 */
export function corgiParts() {
  const ears = [-1, 1].map((side) => ({
    geometry: new ConeGeometry(0.62, 1.5, 14),
    at: [side * 0.82, 5.85, 2.0] as Triple,
    turn: [-0.12, 0, side * -0.38] as Triple,
  }))
  const innerEars = [-1, 1].map((side) => ({
    geometry: new ConeGeometry(0.34, 0.9, 10),
    at: [side * 0.8, 5.75, 2.18] as Triple,
    turn: [-0.12, 0, side * -0.38] as Triple,
  }))
  const paws = [-1, 1].map((side) => sphere([side * 0.68, 1.88, 2.25], [0.5, 0.45, 0.85]))
  const legs = [-1, 1].map((side) => sphere([side * 1.05, 1.95, -2.0], [0.6, 0.5, 0.75]))
  const eyes = [-1, 1].map((side) => sphere([side * 0.5, 4.7, 3.25], [0.16, 0.2, 0.1]))
  return {
    orange: [
      sphere([0, 2.95, -0.3], [1.75, 1.35, 2.8]),
      sphere([0, 4.45, 2.2], [1.4, 1.3, 1.25]),
      sphere([0, 3.3, -3.0], [0.6, 0.55, 0.55]),
      ...legs,
      ...ears,
    ],
    cream: [sphere([0, 4.1, 3.25], [0.85, 0.62, 0.75]), sphere([0, 3.4, 1.95], [1, 1.05, 0.75]), ...paws, ...innerEars],
    ink: [sphere([0, 4.35, 3.98], [0.26, 0.2, 0.18]), ...eyes],
    hedge: [
      { geometry: new CylinderGeometry(1, 1, 1, 28), at: [0, 0.7, 0.2] as Triple, size: [3.2, 1.4, 4.6] as Triple },
    ],
    collar: [
      {
        geometry: new TorusGeometry(1.05, 0.2, 8, 28),
        at: [0, 3.75, 1.95] as Triple,
        turn: [Math.PI / 2 - 0.35, 0, 0] as Triple,
      },
    ],
    tag: [sphere([0, 3.0, 3.05], [0.26, 0.26, 0.12])],
  }
}

/** Points as one flat array of coordinates, for a points geometry such as `Halos`. */
export function glowPositions(spots: readonly Vector3[]) {
  return new Float32Array(spots.flatMap((spot) => spot.toArray()))
}

/** A flower-stem light tower: where it stands, how tall it is, and the point its blossom faces. */
export type FlowerTower = { x: number; z: number; height: number; target: Vector3 }

/** The blossom's frame at the top of `tower`, its face turned toward its target. */
export function blossomFrame(tower: FlowerTower) {
  const top = new Vector3(tower.x, tower.height, tower.z)
  const facing = tower.target.clone().sub(top).normalize()
  const turn = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), facing)
  return new Matrix4().compose(top, turn, new Vector3(1, 1, 1))
}

/** A tower's stem, its two leaves, and the green cup under the blossom. */
export function towerGreenParts(tower: FlowerTower): PlacedPart[] {
  const leaves = [
    [0.32, 0.6],
    [0.55, 3.6],
  ].map(([height, turn]) => {
    const outward = new Vector3(Math.sin(turn + tower.x), 0, Math.cos(turn + tower.x))
    const center = new Vector3(tower.x, tower.height * height + 1.2, tower.z).addScaledVector(outward, 2.2)
    const tilted = outward.clone().setY(0.55).normalize()
    const lean = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), tilted))
    return {
      geometry: unitSphere,
      at: center.toArray() as Triple,
      turn: [lean.x, lean.y, lean.z] as Triple,
      size: [1.1, 0.18, 2.6] as Triple,
    }
  })
  const cup = {
    geometry: new ConeGeometry(1.6, 1.4, 14).rotateX(Math.PI),
    at: [0, -0.4, 0] as Triple,
    size: [1.2, 1.4, 1.2] as Triple,
  }
  return [
    {
      geometry: new CylinderGeometry(0.32, 0.55, 1, 10),
      at: [tower.x, tower.height / 2, tower.z],
      size: [1, tower.height, 1],
    },
    ...leaves,
    ...placeInFrame([cup], blossomFrame(tower)),
  ]
}

/** The blossom's eight petals, alternately white and colored; `colored` picks which to return. */
export function towerBlossomParts(tower: FlowerTower, colored: boolean): PlacedPart[] {
  const petals = Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2
    return {
      geometry: unitSphere,
      at: [Math.cos(angle) * 2.6, 0.6, Math.sin(angle) * 2.6] as Triple,
      turn: [0, -angle, 0.6] as Triple,
      size: [2.3, 0.32, 1.25] as Triple,
      colored: index % 2 === 1,
    }
  }).filter((petal) => petal.colored === colored)
  return placeInFrame(petals, blossomFrame(tower))
}

/** The lamp at the heart of the blossom, which lights up when the town's lamps do. */
export function towerLampParts(tower: FlowerTower): PlacedPart[] {
  return placeInFrame([{ geometry: new CylinderGeometry(1.7, 1.3, 0.7, 20), at: [0, 0.2, 0] }], blossomFrame(tower))
}
