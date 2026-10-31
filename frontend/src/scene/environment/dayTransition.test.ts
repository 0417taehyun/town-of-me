import { describe, expect, it } from 'vitest'
import { createDayChange, createDayLighting, startDayChange, writeDayLighting } from './dayTransition'

const onScreen = (change: ReturnType<typeof createDayChange>, now: number) => {
  const lighting = writeDayLighting(change, now, createDayLighting())
  return [...lighting.sky.toArray(), ...lighting.sunDirection.toArray(), lighting.sunlight, lighting.night]
}

describe('time-of-day change', () => {
  it('carries an interrupted change on from what is on screen and settles on the new period', () => {
    const towardNoon = startDayChange(createDayChange('dawn'), 'noon', 10, false)
    const towardEvening = startDayChange(towardNoon, 'evening', 11.4, false)

    expect(onScreen(towardEvening, 11.4)).toEqual(onScreen(towardNoon, 11.4).map((value) => expect.closeTo(value, 6)))
    expect(onScreen(towardEvening, 11.4 + towardEvening.duration)).toEqual(
      onScreen(createDayChange('evening'), 0).map((value) => expect.closeTo(value, 6)),
    )
  })
})
