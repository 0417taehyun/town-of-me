import { Vector3 } from 'three'

export type DayPeriod = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'sunset' | 'evening'

// Local wall-clock periods deliberately do not require a location or network request.
export function getDayPeriod(date: Date): DayPeriod {
  const hour = date.getHours()
  if (hour < 5 || hour >= 20) return 'evening'
  if (hour < 7) return 'dawn'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 17) return 'afternoon'
  return 'sunset'
}

export const dayPeriods = {
  dawn: {
    label: 'Dawn',
    sky: '#aaa6c9',
    fog: '#b7b1c6',
    light: '#ffdab2',
    skyLight: '#c9c3e6',
    skyLightIntensity: 1.85,
    sunlight: 0.9,
    shadow: 0.45,
    sunHeight: 4,
    sunAzimuth: 78,
    lamps: true,
    night: 0.25,
    cloud: '#efd4d5',
    tempo: 0.7,
    transpose: 0,
    melody: [0, 2, 1, 4, 2, 0, 1, 2],
  },
  morning: {
    label: 'Morning',
    sky: '#afd9e5',
    fog: '#bfdade',
    light: '#fff0d0',
    skyLight: '#d2e9f2',
    skyLightIntensity: 2.65,
    sunlight: 2.1,
    shadow: 0.7,
    sunHeight: 20,
    sunAzimuth: 120,
    lamps: false,
    night: 0,
    cloud: '#fff5e5',
    tempo: 0.47,
    transpose: 2,
    melody: [0, 1, 2, 4, 2, 1, 4, 2],
  },
  noon: {
    label: 'Noon',
    sky: '#89c8ed',
    fog: '#b8d9df',
    light: '#fff8e9',
    skyLight: '#cfe6fa',
    skyLightIntensity: 3,
    sunlight: 2.4,
    shadow: 0.75,
    sunHeight: 46,
    sunAzimuth: 170,
    lamps: false,
    night: 0,
    cloud: '#ffffff',
    tempo: 0.4,
    transpose: 5,
    melody: [4, 2, 1, 2, 0, 2, 4, 1],
  },
  afternoon: {
    label: 'Afternoon',
    sky: '#a8cfca',
    fog: '#b6cec4',
    light: '#ffe6bd',
    skyLight: '#d3e6df',
    skyLightIntensity: 2.5,
    sunlight: 2,
    shadow: 0.7,
    sunHeight: 23,
    sunAzimuth: 225,
    lamps: false,
    night: 0,
    cloud: '#fff0d6',
    tempo: 0.54,
    transpose: 0,
    melody: [2, 1, 0, 2, 4, 2, 1, 0],
  },
  sunset: {
    label: 'Sunset',
    sky: '#dfa4a1',
    fog: '#d9adb0',
    light: '#ffbc85',
    skyLight: '#e2c0c8',
    skyLightIntensity: 1.95,
    sunlight: 1.4,
    shadow: 0.45,
    sunHeight: 3,
    sunAzimuth: 275,
    lamps: true,
    night: 0,
    cloud: '#ffd9b0',
    tempo: 0.62,
    transpose: -3,
    melody: [4, 2, 1, 0, 2, 1, 0, 1],
  },
  evening: {
    label: 'Evening',
    sky: '#25324f',
    fog: '#465875',
    light: '#d6e3ff',
    skyLight: '#8fa3d6',
    skyLightIntensity: 2.4,
    sunlight: 0.8,
    shadow: 0.35,
    sunHeight: 24,
    sunAzimuth: 125,
    lamps: true,
    night: 1,
    cloud: '#73819e',
    tempo: 0.8,
    transpose: -5,
    melody: [0, 2, 4, 2, 1, 0, 2, 1],
  },
} satisfies Record<
  DayPeriod,
  {
    label: string
    sky: string
    fog: string
    light: string
    /** Hemisphere sky color that fills every shadow, so shadows take the sky's tint instead of turning grey. */
    skyLight: string
    skyLightIntensity: number
    sunlight: number
    /** How dark the sun's shadows are, from 0 to 1; a low sun casts fainter ones. */
    shadow: number
    sunHeight: number
    sunAzimuth: number
    lamps: boolean
    /** How much of the night sky shows, from 0 to 1: stars, the moon, and fireflies. */
    night: number
    cloud: string
    tempo: number
    transpose: number
    melody: number[]
  }
>

export type SunPosition = [number, number, number]

export function getSunPosition(period: DayPeriod): SunPosition {
  const { sunAzimuth, sunHeight } = dayPeriods[period]
  const azimuth = (sunAzimuth * Math.PI) / 180
  const horizontalDistance = 24
  return [Math.sin(azimuth) * horizontalDistance, sunHeight, Math.cos(azimuth) * horizontalDistance]
}

/** The sun's shadow camera: a square around the player, kept far enough from the sun to see tall trees. */
export const SUN_SHADOW_FRAME = {
  halfSize: 20,
  // 4 cm per texel over the 40 m frame, softened by PCF; a quarter of the fragments of 2048.
  mapSize: 1024,
  distance: 60,
  /** A dawn or sunset sun would stretch shadows past the frame, so shadows never come from lower than this. */
  minimumElevation: (24 * Math.PI) / 180,
}

export type ShadowLightPlacement = { position: Vector3; target: Vector3 }

const worldUp = new Vector3(0, 1, 0)
const shadowDirection = new Vector3()
const lightRight = new Vector3()
const lightUp = new Vector3()

export function liftToMinimumElevation(direction: Vector3, minimumElevation: number) {
  const horizontal = Math.hypot(direction.x, direction.z)
  if (Math.atan2(direction.y, horizontal) >= minimumElevation) return shadowDirection.copy(direction).normalize()
  const horizontalScale = Math.cos(minimumElevation) / horizontal
  return shadowDirection.set(direction.x * horizontalScale, Math.sin(minimumElevation), direction.z * horizontalScale)
}

/**
 * Where the shadow-casting sun light and its target go to cover `focus`. Both move only in whole shadow-map texels
 * along the light's own axes, so shadow edges stay put instead of shimmering while the player walks.
 */
export function getShadowLightPlacement(
  focus: Vector3,
  sunDirection: Vector3,
  out: ShadowLightPlacement,
  frame = SUN_SHADOW_FRAME,
) {
  const direction = liftToMinimumElevation(sunDirection, frame.minimumElevation)
  // The same right and up axes three.js gives the shadow camera when it looks from the light at the target.
  lightRight.crossVectors(worldUp, direction).normalize()
  lightUp.crossVectors(direction, lightRight)
  const texel = (frame.halfSize * 2) / frame.mapSize
  const snapToTexel = (value: number) => Math.round(value / texel) * texel
  out.target
    .copy(lightRight)
    .multiplyScalar(snapToTexel(focus.dot(lightRight)))
    .addScaledVector(lightUp, snapToTexel(focus.dot(lightUp)))
    .addScaledVector(direction, snapToTexel(focus.dot(direction)))
  out.position.copy(out.target).addScaledVector(direction, frame.distance)
  return out
}
