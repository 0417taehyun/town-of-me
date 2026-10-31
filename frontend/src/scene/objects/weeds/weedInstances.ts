import type { InstancedMesh, Object3D } from 'three'
import type { TownObject } from '../../../data/models'
import { seededFraction } from '../../../motionMath'
import type { Season } from '../../environment/season'
import {
  getStaggeredProgress,
  isSeasonChangeSettled,
  seasonClock,
  startColorFade,
  toLinearColors,
  type ColorFade,
  type SeasonChange,
} from '../../environment/seasonTransition'
import { fadeInstanceColors } from '../../instancedMeshes'
import type { VegetationBend } from '../vegetationMotion'

export const WEED_BLADE_COUNT = 5

export function setWeedMatrices(
  objects: TownObject[],
  bends: VegetationBend[],
  dummy: Object3D,
  blades: InstancedMesh | null,
) {
  objects.forEach((object, objectIndex) => {
    const scale = object.scale ?? 1
    Array.from({ length: WEED_BLADE_COUNT }, (_, blade) => {
      const index = objectIndex * WEED_BLADE_COUNT + blade
      const angle = blade * ((Math.PI * 2) / WEED_BLADE_COUNT) + objectIndex * 0.47
      const bend = bends[objectIndex]
      dummy.position.set(
        object.position.x + Math.cos(angle) * 0.22 + bend.z * 0.24,
        0.58 * scale,
        object.position.z + Math.sin(angle) * 0.22 - bend.x * 0.24,
      )
      dummy.rotation.set(bend.x, angle, (blade - (WEED_BLADE_COUNT - 1) / 2) * 0.18 + bend.z)
      dummy.scale.set(0.17 * scale, 0.62 * scale, 0.1 * scale)
      dummy.updateMatrix()
      blades?.setMatrixAt(index, dummy.matrix)
    })
  })
}

// Weeds dry to straw in winter instead of staying summer-green under the snow.
const weedColors = {
  spring: ['#5f974b'],
  summer: ['#5f974b'],
  autumn: ['#91aa4a', '#a7b94f', '#b9a748'],
  winter: ['#a59f76', '#958f68', '#b1a983'],
} satisfies Record<Season, string[]>

export function weedColorsOf(objects: TownObject[], season: Season) {
  const colors = weedColors[season]
  return toLinearColors(
    objects.flatMap((object, objectIndex) =>
      Array.from(
        { length: WEED_BLADE_COUNT },
        (_, blade) => object.color ?? colors[(objectIndex + blade) % colors.length],
      ),
    ),
  )
}

export type WeedFade = { startedAt: number; colors: ColorFade; settled: boolean }

/** Each weed changes color at its own moment of the change, a step behind the grass around it. */
export function fadeWeedColors(
  blades: InstancedMesh | null,
  fade: { current: WeedFade | null },
  objects: TownObject[],
  change: SeasonChange,
) {
  if (fade.current?.startedAt === change.startedAt && fade.current.settled) return
  if (fade.current?.startedAt !== change.startedAt) {
    const colors = startColorFade(blades?.instanceColor?.array, weedColorsOf(objects, change.to))
    fade.current = { startedAt: change.startedAt, colors, settled: false }
  }
  const now = seasonClock()
  const elapsed = now - change.startedAt
  fadeInstanceColors(blades, fade.current.colors, (index) =>
    getStaggeredProgress(change.timeline.ground, elapsed, seededFraction(Math.floor(index / WEED_BLADE_COUNT), 34)),
  )
  fade.current.settled = isSeasonChangeSettled(change, now)
}
