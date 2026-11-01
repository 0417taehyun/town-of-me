import type { TownObject } from '../../../data/models'
import { clamp01, lerp, smoothstep } from '../../../motionMath'
import { objectVariant, resolveVariant } from '../../objectVariant'
import { FLOWER_VARIANTS, type FlowerVariant } from '../variants'

export const flowerColors = ['#ffd43b', '#ef476f', '#30bced', '#8b5cf6', '#ff8c42', '#ed3fba']

export type FlowerLayout = {
  kind: FlowerVariant
  x: number
  z: number
  height: number
  petalCount: number
  petalColor: string
  centerColor: string
  petalLength: number
  petalWidth: number
  petalDistance: number
  petalThickness: number
  petalTilt: number
  centerSize: number
}

// Past upright, so a closed bud's petal tips lean in to a point.
const BUD_PETAL_TILT = 1.75

/**
 * The kind is the flower's variant; the default color comes from its id, so removing one flower never changes the
 * others.
 */
export function getFlowerLayout(object: TownObject): FlowerLayout {
  const seed = objectVariant(object.id)
  const kind = resolveVariant(object, 'flower')
  const variety = FLOWER_VARIANTS.indexOf(kind)
  const sunflower = kind === 'sunflower'
  const rose = kind === 'rose'
  const tulip = kind === 'tulip'
  const size = object.scale
  return {
    kind,
    x: object.position.x,
    z: object.position.z,
    height: (sunflower ? 1.28 : 0.9 + variety * 0.08) * size,
    petalCount: sunflower ? 12 : rose ? 10 : tulip ? 5 : 8,
    petalColor: object.color ?? (sunflower ? '#ffc928' : flowerColors[seed % flowerColors.length]),
    centerColor: sunflower ? '#4a291c' : rose ? '#7f1737' : '#f09d18',
    petalLength: (sunflower ? 0.34 : rose ? 0.2 : tulip ? 0.25 : 0.28) * size,
    petalWidth: (sunflower ? 0.1 : rose ? 0.16 : tulip ? 0.18 : 0.11) * size,
    petalDistance: (sunflower ? 0.27 : rose ? 0.12 : tulip ? 0.1 : 0.22) * size,
    petalThickness: (rose ? 0.1 : tulip ? 0.12 : 0.055) * size,
    petalTilt: tulip ? 0.7 : rose ? 0.28 : 0,
    centerSize: 0.14,
  }
}

/**
 * How open a flower is, from 1 in full bloom to 0 as a bud. Each flower closes over half of the snowfall, starting
 * somewhere in its first half, and opens the same way as the snow melts.
 */
export function getFlowerBloom(snowCover: number, stagger: number) {
  return 1 - smoothstep(clamp01((snowCover - stagger * 0.5) / 0.5))
}

/** A closing flower sinks on a shorter stem and folds its petals upright around a smaller center. */
export function getFlowerPose(layout: FlowerLayout, bloom: number): FlowerLayout {
  const fold = 1 - bloom
  return {
    ...layout,
    height: layout.height * (1 - 0.35 * fold),
    petalLength: layout.petalLength * (1 - 0.45 * fold),
    petalWidth: layout.petalWidth * (1 - 0.45 * fold),
    petalDistance: layout.petalDistance * (1 - 0.7 * fold),
    petalTilt: lerp(layout.petalTilt, BUD_PETAL_TILT, fold),
    centerSize: layout.centerSize * (1 - 0.5 * fold),
  }
}
