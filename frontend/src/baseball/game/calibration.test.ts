import { describe, expect, it } from 'vitest'
import { calibrate, CALIBRATION_RULES, type PracticeSample } from './calibration'

const swing = (errorMs: number, speed = 8): PracticeSample => ({ errorMs, speed })

describe('swing calibration', () => {
  it('takes the median error of three or more valid practice swings, ignoring swings far off the pitch', () => {
    const wild = CALIBRATION_RULES.validErrorMs + 1
    expect(calibrate([swing(130), swing(95), swing(-wild), swing(110), swing(wild)]).offsetMs).toBe(110)
    expect(calibrate([swing(130), swing(95), swing(110), swing(160)]).offsetMs).toBe(120)
  })

  it('leaves the offset at 0 with fewer than three valid swings, and keeps it within a plausible delay', () => {
    const wild = CALIBRATION_RULES.validErrorMs + 1
    expect(calibrate([swing(120), swing(140), swing(wild), swing(-wild)]).offsetMs).toBe(0)
    expect(calibrate([]).offsetMs).toBe(0)
    const { minimum, maximum } = CALIBRATION_RULES.offsetRange
    expect(calibrate([swing(390), swing(380), swing(395)]).offsetMs).toBe(maximum)
    expect(calibrate([swing(-390), swing(-380), swing(-395)]).offsetMs).toBe(minimum)
  })

  it('reads the peak speed near the top of the practice swings, never below the floor', () => {
    const speeds = [6, 9, 7, 10, 8]
    expect(calibrate(speeds.map((speed) => swing(100, speed))).peakSpeed).toBeCloseTo(9.6, 9)
    const gentle = calibrate([swing(100, 1), swing(90, 2), swing(110, 1.5)])
    expect(gentle.peakSpeed).toBe(CALIBRATION_RULES.peakFloor)
    const offPitch = CALIBRATION_RULES.validErrorMs + 1
    expect(calibrate([swing(offPitch, 12), swing(-offPitch, 12)]).peakSpeed).toBe(CALIBRATION_RULES.peakFloor)
  })

  it('does not let a fast swing far off the pitch raise the peak', () => {
    const offPitch = swing(CALIBRATION_RULES.validErrorMs + 50, 40)
    expect(calibrate([swing(100, 8), swing(90, 8), swing(110, 8), offPitch]).peakSpeed).toBe(8)
  })
})
