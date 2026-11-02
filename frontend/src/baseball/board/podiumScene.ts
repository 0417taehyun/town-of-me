import { type BufferGeometry, Color, DoubleSide, InstancedMesh, MathUtils, MeshStandardMaterial, Object3D } from 'three'
import { getRoundedBox } from '../../scene/roundedBox'
import type { StatueRank } from '../../scene/statues/statueFinishes'

// The board's podium in one canvas: three statues on a low round stage, framed so each stands over its name plate,
// a first look that raises them third to first with a burst of confetti, and a few seconds of life before they rest.

export const PODIUM_FOV = 30
const tanHalfFov = Math.tan(MathUtils.degToRad(PODIUM_FOV / 2))
/** The widest pedestal and a little air, and the top of first place's raised cup. */
const statueRadius = 0.95
const sceneTop = 3.3
const turnToCentre = MathUtils.degToRad(10)
const stageMargin = 1.15
/** Narrower than this (CSS px), the statues stand in steps and the plates stack, as the page's CSS does. */
export const STACKED_WIDTH = 640

export type StatueSlot = { x: number; z: number; turn: number }

/**
 * Phones: first in front, second and third tucked in behind it on either side, far enough out that what the champion
 * raises passes beside their faces.
 */
export const STACKED_SLOTS: Record<StatueRank, StatueSlot> = {
  1: { x: 0, z: 0.45, turn: 0 },
  2: { x: -1.5, z: -0.95, turn: turnToCentre },
  3: { x: 1.5, z: -0.95, turn: -turnToCentre },
}

/**
 * Where the camera stands and the statues stand for a canvas of `aspect`. In a row, second is on the viewer's left and
 * third on the right, both turned a little toward first, and they spread to the centres of three equal columns (2/3 of
 * the visible half width), so each name plate below lands under its statue without measuring the scene.
 */
export function framePodium(aspect: number, stacked: boolean) {
  if (stacked) {
    const halfWidth = STACKED_SLOTS[3].x + statueRadius + 0.15
    const distance = Math.max(halfWidth / (tanHalfFov * aspect), (sceneTop / 2 + 0.35) / tanHalfFov)
    const stage = {
      radiusX: STACKED_SLOTS[3].x + stageMargin,
      radiusZ: 1.75,
      z: (STACKED_SLOTS[1].z + STACKED_SLOTS[2].z) / 2,
    }
    return { distance, lift: 0.2, slots: STACKED_SLOTS, stage }
  }
  const heightDistance = (sceneTop / 2 + 0.3) / tanHalfFov
  const halfWidth = Math.max(3 * statueRadius + 0.15, heightDistance * tanHalfFov * aspect)
  const spread = (halfWidth * 2) / 3
  const slots = {
    1: { x: 0, z: 0, turn: 0 },
    2: { x: -spread, z: 0, turn: turnToCentre },
    3: { x: spread, z: 0, turn: -turnToCentre },
  }
  return {
    distance: halfWidth / (tanHalfFov * aspect),
    lift: 0.12,
    slots,
    stage: { radiusX: spread + stageMargin, radiusZ: 1.3, z: 0 },
  }
}

/** The height the camera looks at, half way up the tallest statue. */
export const LOOK_HEIGHT = sceneTop / 2 - 0.08

/** The first look, in seconds from its start: when each pedestal pops up, then its plate, then the confetti. */
export const REVEAL = {
  popAt: { 1: 1.2, 2: 0.75, 3: 0.3 } as Record<StatueRank, number>,
  popSeconds: 0.45,
  plateDelay: 0.25,
  confettiAt: 1.5,
  confettiSeconds: 1.8,
  end: 3.3,
}

/** The statues move on their own for this long after they appear, then ease to rest (WCAG 2.2.2). */
export const IDLE_SECONDS = 5
const idleFadeSeconds = 1.2

export function easeOutBack(progress: number, overshoot = 1.4) {
  const shifted = progress - 1
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2
}

/** A pedestal's height scale `elapsed` seconds into the first look: 0 before it pops, a little over 1, then 1. */
export function popScale(elapsed: number, rank: StatueRank) {
  const progress = MathUtils.clamp((elapsed - REVEAL.popAt[rank]) / REVEAL.popSeconds, 0, 1)
  return easeOutBack(progress)
}

/** Whether `rank`'s plate has appeared `elapsed` seconds into the first look. */
export function plateShown(elapsed: number, rank: StatueRank) {
  return elapsed >= REVEAL.popAt[rank] + REVEAL.plateDelay
}

/** 1 while the statues may move, easing to 0 by `motionEnds`. */
export function idleMotion(seconds: number, motionEnds: number) {
  return MathUtils.clamp((motionEnds - seconds) / idleFadeSeconds, 0, 1)
}

// The town palette with navy swapped for a pale gold: dark pieces would read as shards.
const confettiColors = ['#6f987c', '#ca7765', '#638fab', '#ece3cc', '#f3e3b0', '#79647c', '#d8b879']
const confettiPieces = 48

export type ConfettiPiece = { x: number; y: number; z: number; fall: number; phase: number; spin: [number, number] }
export type Confetti = { mesh: InstancedMesh<BufferGeometry, MeshStandardMaterial>; pieces: ConfettiPiece[] }

export function confettiPiece(width: number): ConfettiPiece {
  return {
    x: (Math.random() - 0.5) * width,
    y: sceneTop + 0.5 + Math.random() * 1.3,
    z: Math.random() * 1.6 - 0.4,
    fall: 1.7 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    spin: [Math.random() * 7 - 3.5, Math.random() * 5 - 2.5],
  }
}

/** One small burst of instanced paper pieces across `width`. */
export function createConfetti(width: number): Confetti {
  const material = new MeshStandardMaterial({ roughness: 0.85, side: DoubleSide })
  const mesh = new InstancedMesh(getRoundedBox(0.08, 0.12, 0.014, 0.03), material, confettiPieces)
  const color = new Color()
  const pieces = Array.from({ length: confettiPieces }, (_, index) => {
    mesh.setColorAt(index, color.set(confettiColors[index % confettiColors.length]))
    return confettiPiece(width)
  })
  return { mesh, pieces }
}

const placing = new Object3D()

/** Places every piece `age` seconds into its fall, shrinking them out over the last half second. */
export function placeConfetti(confetti: Confetti, age: number) {
  const fade = MathUtils.clamp((REVEAL.confettiSeconds - age) / 0.45, 0, 1)
  confetti.pieces.forEach((piece, index) => {
    placing.position.set(piece.x + Math.sin(piece.phase + age * 3.1) * 0.18, piece.y - piece.fall * age, piece.z)
    placing.rotation.set(piece.spin[0] * age, piece.spin[1] * age, piece.phase)
    placing.scale.setScalar(fade)
    placing.updateMatrix()
    confetti.mesh.setMatrixAt(index, placing.matrix)
  })
  confetti.mesh.instanceMatrix.needsUpdate = true
}

/** A burst across `width`, falling in `parent`. */
export function launchConfetti(parent: Object3D | null, width: number) {
  const burst = createConfetti(width)
  parent?.add(burst.mesh)
  return burst
}

/** Takes a burst away and frees its own material; its rounded box is the town's shared geometry. */
export function dropConfetti(burst: Confetti | null, parent: Object3D | null) {
  if (!burst) return
  parent?.remove(burst.mesh)
  burst.mesh.material.dispose()
  burst.mesh.dispose()
}
