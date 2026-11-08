/** The sharpest pixel ratio a scene renders at; a 3x phone screen stops here rather than paying for every pixel. */
export const MAX_PIXEL_RATIO = 2

/** Where drei's PerformanceMonitor starts its `factor`, halfway, and how far each change moves it. */
export const PIXEL_RATIO_FACTOR = { start: 0.5, step: 0.25 } as const

/**
 * The pixel ratio for the monitor's `factor` (0 to 1) on a screen of `deviceRatio`: from 1 up to the screen's own
 * ratio, at most MAX_PIXEL_RATIO, in quarter steps, so a slow phone gives up a little sharpness at a time instead of
 * dropping straight to 1.
 */
export function pixelRatioFor(factor: number, deviceRatio: number) {
  const sharpest = Math.min(Math.max(deviceRatio, 1), MAX_PIXEL_RATIO)
  return 1 + Math.round((sharpest - 1) * factor * 4) / 4
}

/**
 * The frame rates below and above which the monitor lowers or raises the pixel ratio, aimed at 60 fps on every screen.
 * drei's default aims a 120 Hz phone at 100 fps, so one holding 60 fps went blurry. Measuring against the fastest rate
 * seen would let a weak phone that never passes 35 fps keep a ratio it cannot afford.
 */
export const FRAME_RATE_BOUNDS: [number, number] = [45, 57]

/**
 * Phones and tablets, which have no fine pointer at all. They skip the shadow map, whose extra pass doubled a
 * phone's draw calls, and keep the contact shadows under characters and objects.
 */
export function isTouchOnlyDevice() {
  return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
}
