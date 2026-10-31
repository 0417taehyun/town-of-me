import { Color, Vector3 } from 'three'
import { dayPeriods, getSunPosition, type DayPeriod } from './dayCycle'
import { lerp, smoothstep } from '../../motionMath'

/** What the sky and the lights show at one moment of the day; colors are in the linear working space. */
export type DayLighting = {
  sky: Color
  fog: Color
  sunColor: Color
  skyLight: Color
  cloud: Color
  /** Unit vector from the town toward the sun (or the moon in the evening). */
  sunDirection: Vector3
  sunlight: number
  skyLightIntensity: number
  shadow: number
  night: number
}

export type DayChange = Readonly<{
  /** What was on screen when the change began, so a change made mid-transition carries on instead of jumping. */
  from: DayLighting
  to: DayPeriod
  /** Seconds on `seasonClock`; minus infinity for the period the town opened in, which needs no transition. */
  startedAt: number
  duration: number
}>

export function createDayLighting(period: DayPeriod = 'noon'): DayLighting {
  const settings = dayPeriods[period]
  return {
    sky: new Color(settings.sky),
    fog: new Color(settings.fog),
    sunColor: new Color(settings.light),
    skyLight: new Color(settings.skyLight),
    cloud: new Color(settings.cloud),
    sunDirection: new Vector3(...getSunPosition(period)).normalize(),
    sunlight: settings.sunlight,
    skyLightIntensity: settings.skyLightIntensity,
    shadow: settings.shadow,
    night: settings.night,
  }
}

const periodLighting = Object.fromEntries(
  Object.keys(dayPeriods).map((period) => [period, createDayLighting(period as DayPeriod)]),
) as Record<DayPeriod, DayLighting>

/** Reduced motion keeps the fade but shortens it, as the season change does, so the sun does not sweep for long. */
export const getDayChangeDuration = (reducedMotion: boolean) => (reducedMotion ? 1.2 : 3)

export function createDayChange(period: DayPeriod): DayChange {
  return { from: periodLighting[period], to: period, startedAt: -Infinity, duration: 0 }
}

export function getDayChangeProgress(change: DayChange, now: number) {
  const elapsed = now - change.startedAt
  if (elapsed >= change.duration) return 1
  return smoothstep(Math.max(0, elapsed / change.duration))
}

export function writeDayLighting(change: DayChange, now: number, out: DayLighting) {
  const progress = getDayChangeProgress(change, now)
  const { from } = change
  const to = periodLighting[change.to]
  out.sky.lerpColors(from.sky, to.sky, progress)
  out.fog.lerpColors(from.fog, to.fog, progress)
  out.sunColor.lerpColors(from.sunColor, to.sunColor, progress)
  out.skyLight.lerpColors(from.skyLight, to.skyLight, progress)
  out.cloud.lerpColors(from.cloud, to.cloud, progress)
  // Every period's sun is above the horizon, so the blend never passes through zero length.
  out.sunDirection.lerpVectors(from.sunDirection, to.sunDirection, progress).normalize()
  out.sunlight = lerp(from.sunlight, to.sunlight, progress)
  out.skyLightIntensity = lerp(from.skyLightIntensity, to.skyLightIntensity, progress)
  out.shadow = lerp(from.shadow, to.shadow, progress)
  out.night = lerp(from.night, to.night, progress)
  return out
}

export function startDayChange(previous: DayChange, to: DayPeriod, now: number, reducedMotion: boolean): DayChange {
  return {
    from: writeDayLighting(previous, now, createDayLighting()),
    to,
    startedAt: now,
    duration: getDayChangeDuration(reducedMotion),
  }
}
