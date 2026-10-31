import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const roundedBoxes = new Map<string, RoundedBoxGeometry>()

/**
 * One rounded box per size, shared by every mesh that uses it and built with two segments per corner: these props
 * are small on screen, and drei's extruded version built a 2,000-vertex geometry for each mesh.
 */
export function getRoundedBox(width: number, height: number, depth: number, radius: number) {
  const key = `${width}:${height}:${depth}:${radius}`
  const geometry = roundedBoxes.get(key) ?? new RoundedBoxGeometry(width, height, depth, 2, radius)
  roundedBoxes.set(key, geometry)
  return geometry
}
