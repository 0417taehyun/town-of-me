import { Vector3 } from 'three'

// The town character's measurements in its body's space (ground at y 0, facing +z, town units): what
// ProceduralCharacter.tsx draws and the /baseball ballplayer rig (baseball/stage/actors/ballplayerRig.ts) poses. The
// hips and the legs' lengths are the walk's (motion/walkCycle.ts: HIP_HEIGHT, HIP_WIDTH, THIGH_LENGTH, SHIN_LENGTH).

export const CHARACTER_BODY = {
  /** A rounded box this size and rounding, centered this high. */
  torso: { width: 0.64, height: 0.64, depth: 0.38, rounding: 0.14, centerY: 1.04 },
  headHeight: 1.67,
  /** Where each arm hangs from, at ±x. */
  armPivot: { x: 0.43, y: 1.25 },
  /** A shirt's two collar points: rounded boxes centered at (±x, y, z), each turned ±`turn` (radians) about z. */
  collar: {
    width: 0.16,
    height: 0.12,
    depth: 0.04,
    rounding: 0.015,
    x: 0.09,
    y: 1.31,
    z: 0.21,
    turn: 0.35,
    color: '#eee6d5',
  },
}

/** A rounded box of the character: its size, its rounding, and its center in its group's space. */
export type BodySolid = { size: [number, number, number]; rounding: number; center: Vector3 }

/**
 * A thigh (in its hip), a shin (in its knee), and a shoe (in its ankle), wider in relaxed trousers and taller in
 * boots. Each call makes new centers, so a caller may move them.
 */
export function characterLegSolids({ relaxed, boots }: { relaxed: boolean; boots: boolean }) {
  return {
    thigh: { size: [relaxed ? 0.3 : 0.24, 0.36, 0.28], rounding: 0.08, center: new Vector3(0, -0.18, 0) },
    shin: { size: [relaxed ? 0.27 : 0.21, 0.28, 0.24], rounding: 0.075, center: new Vector3(0, -0.14, 0) },
    shoe: {
      size: [0.27, boots ? 0.25 : 0.15, 0.41],
      rounding: boots ? 0.08 : 0.055,
      center: new Vector3(0, boots ? 0.05 : 0, 0.07),
    },
  } satisfies Record<string, BodySolid>
}
