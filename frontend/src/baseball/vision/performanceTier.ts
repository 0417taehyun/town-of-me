import { percentile } from '../statistics'

// How well this computer tracks a swing, measured on every visit while the visitor finds their spot (nothing is
// stored: there is no stale result to invalidate after a browser, driver, or camera change). Two things are timed, as
// model-runtime.md §2 sets out: the pose task on each camera frame, and the gaps between the frames the page draws
// while the task shares the main thread with the stadium. The camera's own frame rate is not counted against the
// computer: a 24 fps webcam on a fast computer still draws every frame on time. The first frames of a new task compile
// shaders and are slow on any device, so they are dropped. The limits are PLAN §8's for the GPU + Lite and the slower
// CPU + Lite tiers; a computer that meets neither is too slow to play on. A tier is earned by its numbers on whichever
// delegate tasksVision.ts could start, since a GPU too slow for the first tier is still faster than the CPU would be.

export const TIER_MEASUREMENT = { warmUpFrames: 15, measuredFrames: 90 }

/** Best first; a device that meets neither is too slow to track a swing. */
export const PERFORMANCE_TIERS = [
  { tier: 'smooth', inferenceMs: 18, frameIntervalMs: 40 },
  { tier: 'reduced', inferenceMs: 28, frameIntervalMs: 45 },
] as const

export type PerformanceTier = (typeof PERFORMANCE_TIERS)[number]['tier']

/**
 * One camera frame: how long the pose task took on it, and the gaps (ms) between the frames the page drew since the
 * camera frame before it.
 */
export type FrameTiming = { inferenceMs: number; frameIntervalsMs: readonly number[] }

export type TimingSummary = { inferenceMs: number; frameIntervalMs: number }

/**
 * The 95th percentiles of inference time and of the gaps between drawn frames over the newest measured camera
 * frames, or null until the warm-up and that many camera frames after it have come.
 */
export function timingSummary(frames: readonly FrameTiming[]): TimingSummary | null {
  const { warmUpFrames, measuredFrames } = TIER_MEASUREMENT
  if (frames.length < warmUpFrames + measuredFrames) return null
  const measured = frames.slice(-measuredFrames)
  const inferences = measured.map((frame) => frame.inferenceMs)
  const intervals = measured.flatMap((frame) => frame.frameIntervalsMs)
  return { inferenceMs: percentile(inferences, 0.95), frameIntervalMs: percentile(intervals, 0.95) }
}

/** The best tier `summary` meets, or null when it meets none and the camera game cannot be played here. */
export function performanceTier(summary: TimingSummary): PerformanceTier | null {
  const met = PERFORMANCE_TIERS.find(
    (limits) => summary.inferenceMs <= limits.inferenceMs && summary.frameIntervalMs <= limits.frameIntervalMs,
  )
  return met?.tier ?? null
}
