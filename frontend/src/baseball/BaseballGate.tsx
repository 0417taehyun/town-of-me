import { lazy, Suspense, useEffect } from 'react'
import { usePageLanguage } from '../hooks/usePageLanguage'
import { type AppLanguage, languageCopy } from '../i18n/language'
import { LanguageSelect } from '../ui/LanguageSelect'
import { baseballPreview, EXIT_PATHS } from './baseballRoute'
import { useBallparkGate } from './useBallparkGate'

const BaseballApp = lazy(() => import('./BaseballApp').then((module) => ({ default: module.BaseballApp })))

/**
 * `/baseball` reads the town before anything of the derby loads: while the admin hides the ballpark, only the admin's
 * preview opens it, and anyone else gets a card in the town's style without the derby's chunk or the camera.
 */
export function BaseballGate({ townId }: { townId: string }) {
  const { gate, retry } = useBallparkGate(townId, baseballPreview(window.location.search) !== null)
  const [language, setLanguage] = usePageLanguage()
  const copy = languageCopy[language]

  if (gate.status === 'failed')
    return (
      <main className="load-state">
        <p>{copy.baseball.loadError}</p>
        <small>{gate.error}</small>
        <button className="primary-button compact" type="button" onClick={retry}>
          {copy.app.retry}
        </button>
      </main>
    )
  if (gate.status === 'closed') return <BallparkComingSoon language={language} onLanguageChange={setLanguage} />
  const loading = <BaseballLoading language={language} />
  if (gate.status === 'loading') return loading
  return (
    <Suspense fallback={loading}>
      <BaseballApp town={gate.town} />
    </Suspense>
  )
}

export function BaseballLoading({ language }: { language: AppLanguage }) {
  return (
    <main className="load-state" aria-busy="true">
      <span className="loader" aria-hidden="true" />
      <p role="status">{languageCopy[language].baseball.loading}</p>
    </main>
  )
}

/** What a visitor sees at `/baseball` while the admin hides the ballpark, with the way back to the town. */
export function BallparkComingSoon({
  language,
  onLanguageChange,
}: {
  language: AppLanguage
  onLanguageChange: (language: AppLanguage) => void
}) {
  const copy = languageCopy[language].baseball

  useEffect(() => {
    document.title = copy.documentTitle
  }, [copy.documentTitle])

  return (
    <main className="ballpark-soon">
      <section className="entry-card" aria-labelledby="ballpark-soon-title">
        <LanguageSelect language={language} className="entry-language-select" onChange={onLanguageChange} />
        <p className="eyebrow">{copy.title}</p>
        <h1 id="ballpark-soon-title">{copy.comingSoon.title}</h1>
        <p className="entry-copy">{copy.comingSoon.description}</p>
        <a className="primary-button guest-button" href={EXIT_PATHS.town}>
          <span aria-hidden="true">←</span>
          {copy.back.town}
        </a>
      </section>
    </main>
  )
}
