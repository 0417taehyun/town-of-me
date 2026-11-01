import { AdditiveBlending, Group, type PerspectiveCamera, Sprite, SpriteMaterial, Vector3 } from 'three'
import type { Vec3 } from '../../data/models'
import { type PitchPlan, pitchPosition } from '../game/pitch'
import { createGlowTexture, minimumScreenScale } from './ballMeshes'
import { mittSeconds, type StageEvent, type StageRun } from './stageRun'

// Brief bursts of light on the stage: a small one as the ball leaves the pitcher's hand, a big one where the bat meets
// it, and a puff as it pops into the catcher's mitt. They play on the real clock, so the hit-stop that holds the game
// still shows the contact's, and draw over everything, since the catcher's head hides his mitt from the batting shot.

/** How big (m) a flash grows, how long (real ms) it lasts, and its colour. */
export type FlashLook = { size: number; durationMs: number; color: string }

export const FLASH_LOOKS = {
  release: { size: 0.9, durationMs: 220, color: '#fff1c4' },
  contact: { size: 1.6, durationMs: 300, color: '#fff1c4' },
  caught: { size: 0.6, durationMs: 200, color: '#e9d7b0' },
} satisfies Record<string, FlashLook>

/** The fewest pixels across a flash may shrink to as it starts, and half that as it ends. */
export const FLASH_PIXELS = 40
/** Flashes at once; a new one takes the oldest's place. */
export const FLASH_COUNT = 3
/** How far (normalized device units) above the screen's bottom edge the catch's puff stays, where the ball was last seen. */
export const PUFF_ABOVE_BOTTOM = 0.08

export type Flash = { sprite: Sprite; startedMs: number; look: FlashLook }

export type Flashes = { group: Group; flashes: Flash[] }

export function createFlashes(): Flashes {
  const map = createGlowTexture()
  const flashes = Array.from({ length: FLASH_COUNT }, () => {
    const material = new SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      fog: false,
      opacity: 0,
    })
    const sprite = new Sprite(material)
    sprite.visible = false
    sprite.renderOrder = 3
    return { sprite, startedMs: -Infinity, look: FLASH_LOOKS.release }
  })
  const group = new Group()
  group.add(...flashes.map((flash) => flash.sprite))
  return { group, flashes }
}

export function disposeFlashes({ flashes }: Flashes) {
  flashes[0].sprite.material.map?.dispose()
  flashes.forEach((flash) => flash.sprite.material.dispose())
}

const seen = new Vector3()

/**
 * Where on its way into the mitt the batting shot last sees a pitch not hit: the mitt itself sits under the bottom edge,
 * behind the catcher's head, so the catch's puff shows where the ball went out of view.
 */
export function lastSeenOnWayToMitt(plan: PitchPlan, camera: PerspectiveCamera): Vec3 {
  const caughtSeconds = mittSeconds(plan)
  const way = Array.from({ length: 20 }, (_, step) => pitchPosition(plan, caughtSeconds - step * 0.01))
  const bottom = PUFF_ABOVE_BOTTOM - 1
  return way.find((point) => seen.set(point.x, point.y, point.z).project(camera).y >= bottom) ?? way[0]
}

/** Where and how an event of `run` flashes, seen through `camera`; null for one that does not. */
export function flashFor(
  event: StageEvent,
  run: StageRun,
  camera: PerspectiveCamera,
): { at: Vec3; look: FlashLook } | null {
  if (event.type === 'release') return { at: pitchPosition(event.pitch, 0), look: FLASH_LOOKS.release }
  if (event.type === 'contact' && run.batted) return { at: run.batted.start, look: FLASH_LOOKS.contact }
  if (event.type !== 'caught' || !run.pitch) return null
  return { at: lastSeenOnWayToMitt(run.pitch.plan, camera), look: FLASH_LOOKS.caught }
}

/** Starts the flash of an event, if it has one, at real moment `realMs`, in place of the oldest. */
export function startFlash(
  { flashes }: Flashes,
  event: StageEvent,
  run: StageRun,
  camera: PerspectiveCamera,
  realMs: number,
) {
  const flash = flashFor(event, run, camera)
  if (!flash) return
  const oldestMs = Math.min(...flashes.map((candidate) => candidate.startedMs))
  const oldest = flashes.find((candidate) => candidate.startedMs === oldestMs) ?? flashes[0]
  oldest.sprite.position.set(flash.at.x, flash.at.y, flash.at.z)
  oldest.sprite.material.color.set(flash.look.color)
  oldest.startedMs = realMs
  oldest.look = flash.look
}

/** Each flash at real moment `realMs`: growing and fading out over its time, then gone. */
export function drawFlashes({ flashes }: Flashes, camera: PerspectiveCamera, viewportHeight: number, realMs: number) {
  flashes.forEach((flash) => drawFlash(flash, camera, viewportHeight, realMs))
}

export function drawFlash(flash: Flash, camera: PerspectiveCamera, viewportHeight: number, realMs: number) {
  const { sprite, look } = flash
  const progress = (realMs - flash.startedMs) / look.durationMs
  sprite.visible = progress >= 0 && progress < 1
  if (!sprite.visible) return
  sprite.material.opacity = 1 - progress
  const grown = look.size * (0.4 + progress)
  const distance = camera.position.distanceTo(sprite.position)
  const pixels = FLASH_PIXELS * (1 - progress / 2)
  sprite.scale.setScalar(grown * minimumScreenScale(distance, camera.fov, viewportHeight, pixels, grown))
}
