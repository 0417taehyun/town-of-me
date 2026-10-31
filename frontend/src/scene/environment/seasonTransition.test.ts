import { describe, expect, it } from 'vitest'
import {
  createSeasonChange,
  getGroundCoverAmount,
  getSeasonTimeline,
  getSnowCover,
  getStaggeredWindow,
  getWindowProgress,
  isSeasonChangeSettled,
  startColorFade,
  startSeasonChange,
  writeColorFade,
} from './seasonTransition'

describe('season transitions', () => {
  it('sheds leaves before snow settles, and melts snow before leaves return', () => {
    const intoWinter = getSeasonTimeline('autumn', 'winter', false)
    expect(intoWinter.particlesIn.start).toBeGreaterThan((intoWinter.leafDrop?.end ?? 0) * 0.6)
    expect(intoWinter.snowCover.start).toBeGreaterThan(intoWinter.particlesIn.start)
    expect(intoWinter.leavesRestUntil).toBeLessThan(intoWinter.snowCover.end)
    const outOfWinter = getSeasonTimeline('winter', 'spring', false)
    expect(outOfWinter.leafDrop).toBeNull()
    expect(outOfWinter.foliage.start).toBeGreaterThan(outOfWinter.snowCover.start)
    expect(outOfWinter.particlesIn.start).toBeGreaterThan(outOfWinter.snowCover.end)
  })

  it('needs no transition for the opening season and keeps reduced motion short and still', () => {
    expect(isSeasonChangeSettled(createSeasonChange('autumn'), 0)).toBe(true)
    expect(getSnowCover(createSeasonChange('winter'), 0)).toBe(1)
    expect(getSnowCover(createSeasonChange('summer'), 0)).toBe(0)
    const gentle = getSeasonTimeline('autumn', 'winter', true)
    expect(gentle.leafDrop).toBeNull()
    expect(gentle.end).toBeLessThanOrEqual(1.2)
  })

  it('eases each window and gives every tree its own part of it', () => {
    const window = { start: 2, end: 6 }
    expect(getWindowProgress(window, 1)).toBe(0)
    expect(getWindowProgress(window, 4)).toBeCloseTo(0.5)
    expect(getWindowProgress(window, 7)).toBe(1)
    expect(getWindowProgress({ start: 0, end: 0 }, 0)).toBe(1)
    const first = getStaggeredWindow(window, 0)
    const last = getStaggeredWindow(window, 0.999)
    expect(first.start).toBe(2)
    expect(last.start).toBeGreaterThan(first.end - 0.5)
    expect(last.end).toBeLessThanOrEqual(6)
  })

  it('continues an interrupted melt from the snow still on the ground', () => {
    const winter = createSeasonChange('winter')
    const melting = startSeasonChange(winter, 'spring', 100, false)
    const halfway = (melting.timeline.snowCover.start + melting.timeline.snowCover.end) / 2
    const coverAtTurn = getSnowCover(melting, 100 + halfway)
    expect(coverAtTurn).toBeGreaterThan(0.2)
    expect(coverAtTurn).toBeLessThan(0.8)
    const backToWinter = startSeasonChange(melting, 'winter', 100 + halfway, false)
    expect(backToWinter.from).toBe('spring')
    expect(getSnowCover(backToWinter, 100 + halfway)).toBeCloseTo(coverAtTurn)
    expect(getSnowCover(backToWinter, 200)).toBe(1)
  })

  it('keeps fallen leaves on the ground until the snow buries them', () => {
    const change = startSeasonChange(createSeasonChange('autumn'), 'winter', 0, false)
    const { foliage, snowCover } = change.timeline
    expect(getGroundCoverAmount('autumn', change, foliage.end)).toBe(1)
    expect(getGroundCoverAmount('winter', change, foliage.end)).toBe(0)
    expect(getGroundCoverAmount('autumn', change, snowCover.end)).toBe(0)
    expect(getGroundCoverAmount('winter', change, snowCover.end)).toBe(1)
    expect(getGroundCoverAmount('spring', change, snowCover.end)).toBe(0)
    expect(getGroundCoverAmount('autumn', createSeasonChange('autumn'), 0)).toBe(1)
  })

  it('fades colors from what is on screen toward the new season', () => {
    const target = new Float32Array([1, 1, 1, 0, 0, 0])
    const fade = startColorFade(new Float32Array([0, 0, 0, 1, 1, 1]), target)
    const out = new Float32Array(6)
    writeColorFade(fade, (index) => (index === 0 ? 0.25 : 1), out)
    expect(Array.from(out)).toEqual([0.25, 0.25, 0.25, 0, 0, 0])
    expect(Array.from(startColorFade(undefined, target).from)).toEqual(Array.from(target))
  })
})
