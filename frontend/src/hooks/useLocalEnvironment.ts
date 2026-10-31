import { useEffect, useState } from 'react'
import { getDayPeriod } from '../scene/environment/dayCycle'
import { getSeason } from '../scene/environment/season'

/**
 * The device's time of day and season, checked every 30 seconds and whenever the tab comes back into view. The town
 * and the ballpark both follow it; it changes only how they look.
 */
export function useLocalEnvironment() {
  const [period, setPeriod] = useState(() => getDayPeriod(new Date()))
  const [season, setSeason] = useState(() => getSeason(new Date()))
  useEffect(() => {
    const update = () => {
      const currentDate = new Date()
      setPeriod(getDayPeriod(currentDate))
      setSeason(getSeason(currentDate))
    }
    const timer = window.setInterval(update, 30000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return { period, season }
}
