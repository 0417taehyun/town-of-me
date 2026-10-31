export type Control = 'forward' | 'backward' | 'left' | 'right' | 'sprint'

export const AUTO_SPRINT_SECONDS = 0.65

export function movementHoldDuration(previous: number, horizontal: number, vertical: number, delta: number) {
  if (Math.hypot(horizontal, vertical) < 0.2) return 0
  return Math.min(AUTO_SPRINT_SECONDS, previous + Math.max(0, delta))
}

export function shouldSprint(heldSeconds: number, manuallyPressed: boolean) {
  return manuallyPressed || heldSeconds >= AUTO_SPRINT_SECONDS
}

export function claimControlPointer(current: number | null, pointerId: number) {
  return current ?? pointerId
}

export function releaseControlPointer(current: number | null, pointerId: number) {
  return current === pointerId ? null : current
}

export type ScreenPoint = { x: number; y: number }

/** The spread between two touches and the point midway between them, for pinch zoom and two-finger glancing. */
export function measurePinch(first: ScreenPoint, second: ScreenPoint) {
  return {
    distance: Math.hypot(first.x - second.x, first.y - second.y),
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

export const keyboardMap = [
  { name: 'forward' as const, keys: ['ArrowUp', 'KeyW'] },
  { name: 'backward' as const, keys: ['ArrowDown', 'KeyS'] },
  { name: 'left' as const, keys: ['ArrowLeft', 'KeyA'] },
  { name: 'right' as const, keys: ['ArrowRight', 'KeyD'] },
  { name: 'sprint' as const, keys: ['ShiftLeft', 'ShiftRight'] },
]
