import { describe, expect, it } from 'vitest'
import { type FrameTiming, performanceTier, TIER_MEASUREMENT, timingSummary } from './performanceTier'

/** A 60 Hz screen's drawn-frame gap (ms). */
const VSYNC = 1000 / 60

/** `count` camera frames, each taking the pose task `inferenceMs` and spanning the drawn-frame gaps `drawn`. */
function frames(count: number, inferenceMs: number, drawn: readonly number[] = [VSYNC, VSYNC]): FrameTiming[] {
  return Array.from({ length: count }, () => ({ inferenceMs, frameIntervalsMs: drawn }))
}

/** The tier for `measured` camera frames that come after a slow warm-up. */
function measuredTier(measured: FrameTiming[]) {
  const warmUp = frames(TIER_MEASUREMENT.warmUpFrames, 240, [250])
  const summary = timingSummary([...warmUp, ...measured])
  return summary && performanceTier(summary)
}

describe('the performance tier', () => {
  it('waits for the warm-up and the measured frames, then ignores the slow warm-up', () => {
    const { warmUpFrames, measuredFrames } = TIER_MEASUREMENT
    expect(timingSummary(frames(warmUpFrames + measuredFrames - 1, 9))).toBeNull()
    expect(measuredTier(frames(measuredFrames, 9))).toBe('smooth')
  })

  it('reads the 95th percentile, so a few slow frames do not cost a tier and many do', () => {
    const { measuredFrames } = TIER_MEASUREMENT
    const withSlowFrames = (slow: number) =>
      frames(measuredFrames, 9).map((frame, index) => ({ ...frame, inferenceMs: index < slow ? 25 : 9 }))
    expect(measuredTier(withSlowFrames(4))).toBe('smooth')
    expect(measuredTier(withSlowFrames(6))).toBe('reduced')
    expect(measuredTier(frames(measuredFrames, 31))).toBeNull()
  })

  it('judges the computer by the frames it draws, not by how few frames the camera sends', () => {
    const { measuredFrames } = TIER_MEASUREMENT
    // A 24 fps webcam on a 60 Hz screen: each camera frame spans two or three drawn frames, all on time.
    const slowCamera = frames(measuredFrames, 9).map((frame, index) => ({
      ...frame,
      frameIntervalsMs: index % 2 ? [VSYNC, VSYNC, VSYNC] : [VSYNC, VSYNC],
    }))
    expect(measuredTier(slowCamera)).toBe('smooth')
    // The same camera on a computer that draws only every third frame.
    expect(measuredTier(frames(measuredFrames, 9, [VSYNC * 3]))).toBeNull()
    expect(measuredTier(frames(measuredFrames, 9, [42]))).toBe('reduced')
  })
})
