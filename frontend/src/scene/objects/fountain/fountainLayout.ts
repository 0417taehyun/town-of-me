import type { TownObject } from '../../../data/models'

export const FOUNTAIN_RADIUS = 2.5
/** The basin's water surface, where the jets land and the ice forms. */
export const FOUNTAIN_WATER_LEVEL = 0.315
/** The paved plaza drawn on the ground around the fountain. */
export const PLAZA_RADIUS = 9.2

/** Meters from a point to the basin's rim; `Infinity` for a town without a fountain. */
export function getFountainRimDistance(fountain: TownObject | undefined, x: number, z: number) {
  if (!fountain) return Infinity
  const fromCenter = Math.hypot(x - fountain.position.x, z - fountain.position.z)
  return Math.max(0, fromCenter - FOUNTAIN_RADIUS * fountain.scale)
}
