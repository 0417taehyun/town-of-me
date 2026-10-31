import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DayPeriod } from './dayCycle'
import { createDayChange, getDayChangeDuration, startDayChange } from './dayTransition'
import { seasonClock } from './seasonTransition'

/** The town's time of day, faded over a few seconds instead of switched at once; read it every frame. */
export function useDayChange(period: DayPeriod, reducedMotion: boolean) {
  const change = useRef(createDayChange(period))
  useLayoutEffect(() => {
    if (change.current.to === period) return
    change.current = startDayChange(change.current, period, seasonClock(), reducedMotion)
  }, [period, reducedMotion])
  return change
}

/** Lamps and windows switch halfway through a time-of-day change, when the sky is half way dark or light. */
export function useLampsOn(lampsOn: boolean, reducedMotion: boolean) {
  const [shownLampsOn, setShownLampsOn] = useState(lampsOn)
  useEffect(() => {
    const timer = window.setTimeout(() => setShownLampsOn(lampsOn), getDayChangeDuration(reducedMotion) * 500)
    return () => window.clearTimeout(timer)
  }, [lampsOn, reducedMotion])
  return shownLampsOn
}
