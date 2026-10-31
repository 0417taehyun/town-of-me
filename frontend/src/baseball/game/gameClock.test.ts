import { describe, expect, it } from 'vitest'
import { createGameClock, gameTime, holdClock, setClockRate } from './gameClock'

describe('game clock', () => {
  it('never jumps when slow motion or a pause starts or ends, and runs at the rate in between', () => {
    let clock = createGameClock(5000)
    expect(gameTime(clock, 6000)).toBe(1000)
    clock = setClockRate(clock, 6000, 0.25)
    expect(gameTime(clock, 6000)).toBe(1000)
    expect(gameTime(clock, 6400)).toBe(1100)
    clock = setClockRate(clock, 6400, 0)
    expect(gameTime(clock, 9000)).toBe(1100)
    clock = setClockRate(clock, 9000, 1)
    expect(gameTime(clock, 9500)).toBe(1600)
  })

  it('holds still through a hit-stop, then runs on at the rate it had without losing or gaining time', () => {
    const slow = setClockRate(createGameClock(0), 1000, 0.5)
    const held = holdClock(slow, 2000, 120)
    expect(gameTime(held, 2000)).toBe(1500)
    expect(gameTime(held, 2060)).toBe(1500)
    expect(gameTime(held, 2120)).toBe(1500)
    expect(gameTime(held, 2320)).toBe(1600)
  })

  it('holds a moment just past for a hit-stop that comes late, never one still to come', () => {
    const clock = createGameClock(0)
    const late = holdClock(clock, 1000, 90, 885)
    expect(gameTime(late, 1000)).toBe(885)
    expect(gameTime(late, 1090)).toBe(885)
    expect(gameTime(late, 1190)).toBe(985)
    expect(gameTime(holdClock(clock, 1000, 90, 1200), 1050)).toBe(1000)
  })

  it('keeps the whole hit-stop when slow motion starts at the same contact, then runs at the new rate', () => {
    const slowed = setClockRate(holdClock(createGameClock(0), 1000, 120), 1000, 0.25)
    expect(gameTime(slowed, 1060)).toBe(1000)
    expect(gameTime(slowed, 1120)).toBe(1000)
    expect(gameTime(slowed, 1520)).toBe(1100)
  })
})
