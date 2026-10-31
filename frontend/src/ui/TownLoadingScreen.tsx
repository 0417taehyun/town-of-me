import { useEffect, useState, type CSSProperties } from 'react'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'

const SHUTTLE_TRIP_MILLISECONDS = 4000
const READY_HOLD_MILLISECONDS = 450

export function TownLoadingScreen({
  language,
  ready,
  progress,
  onFinished,
}: {
  language: AppLanguage
  ready: boolean
  progress: number
  onFinished?: () => void
}) {
  const [messageIndex, setMessageIndex] = useState(0)
  const [tripFinished, setTripFinished] = useState(false)
  const messages = languageCopy[language].loading.messages
  const displayedProgress = ready ? 100 : Math.min(95, Math.max(8, Math.round(progress)))

  useEffect(() => {
    const timer = window.setTimeout(() => setTripFinished(true), SHUTTLE_TRIP_MILLISECONDS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (ready) return
    const timer = window.setInterval(() => setMessageIndex((index) => (index + 1) % messages.length), 1600)
    return () => window.clearInterval(timer)
  }, [messages.length, ready])

  useEffect(() => {
    if (!ready || !tripFinished || !onFinished) return
    const timer = window.setTimeout(onFinished, READY_HOLD_MILLISECONDS)
    return () => window.clearTimeout(timer)
  }, [onFinished, ready, tripFinished])

  return (
    <main
      className="town-loading"
      role="status"
      aria-live="polite"
      style={{ '--shuttle-trip-duration': `${SHUTTLE_TRIP_MILLISECONDS}ms` } as CSSProperties}
    >
      <div className="town-loading-card">
        <div className="loading-route" aria-hidden="true">
          <span className="loading-shuttle is-departing">
            <span className="loading-dust">💨</span>
            <span className="loading-bus">🚐</span>
          </span>
          <span className="loading-route-line" />
        </div>
        <p>{messages[messageIndex]}</p>
        <div
          className="town-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={displayedProgress}
        >
          <span style={{ width: `${displayedProgress}%` }} />
        </div>
        <output>{displayedProgress}%</output>
      </div>
    </main>
  )
}
