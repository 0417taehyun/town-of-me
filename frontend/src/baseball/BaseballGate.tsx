import { lazy, Suspense, useEffect, useState } from 'react'
import { usePageLanguage } from '../hooks/usePageLanguage'
import type { TownSnapshot } from '../data/models'
import { type AppLanguage, languageCopy } from '../i18n/language'
import { LanguageSelect } from '../ui/LanguageSelect'
import { baseballPreview, EXIT_PATHS, isBoardPath, isHallOfFameView } from './baseballRoute'
import { useBallparkGate } from './useBallparkGate'

const BaseballApp = lazy(() => import('./BaseballApp').then((module) => ({ default: module.BaseballApp })))
const BoardPage = lazy(() => import('./board/BoardPage').then((module) => ({ default: module.BoardPage })))
const HallOfFamePage = lazy(() =>
  import('./board/HallOfFamePage').then((module) => ({ default: module.HallOfFamePage })),
)

/**
 * `/baseball` reads the town before anything of the derby loads: while the admin hides the ballpark, only the admin's
 * preview opens it, and anyone else gets a card in the town's style without the derby's chunk or the camera. Its board
 * (`/baseball/ranking`) opens with the ballpark and has no preview, so nothing ranked shows while it is hidden.
 */
export function BaseballGate({ townId }: { townId: string }) {
  const [board] = useState(() => isBoardPath(window.location.pathname))
  const { gate, retry } = useBallparkGate(townId, !board && baseballPreview(window.location.search) !== null)
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
    <Suspense fallback={loading}>{board ? <BoardRoute town={gate.town} /> : <BaseballApp town={gate.town} />}</Suspense>
  )
}

/** The board's address opens a season's board or the hall of fame, both only once the gate is open. */
export function BoardRoute({ town }: { town: TownSnapshot }) {
  return isHallOfFameView(window.location.search) ? <HallOfFamePage town={town} /> : <BoardPage town={town} />
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
