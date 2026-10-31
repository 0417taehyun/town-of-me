import { lazy, Suspense, useEffect, useState } from 'react'
import { effectiveBallparkRules, rankingMonth, upcomingBallparkRules } from '../data/ballparkRules'
import { InMemoryDemoRepository } from '../data/InMemoryDemoRepository'
import { normalizePlayerProfile } from '../data/playerProfile'
import { fetchTownLayout } from '../data/townApi'
import { useDemoSession } from '../hooks/useDemoSession'
import { usePageLanguage } from '../hooks/usePageLanguage'
import { languageCopy, monthName } from '../i18n/language'
import { LanguageSelect } from '../ui/LanguageSelect'
import { needsCharacter, withVenueProfile } from './baseballSession'
import './baseball.css'

const CharacterCreator = lazy(() =>
  import('../ui/CharacterCreator').then((module) => ({ default: module.CharacterCreator })),
)

/** The home run derby page: the same town and tab session as the town, so a visitor plays as their character. */
export function BaseballApp({ townId }: { townId: string }) {
  const [repository] = useState(() => new InMemoryDemoRepository(fetchTownLayout))
  const { town, session, error, save, retry } = useDemoSession(repository, townId)
  const [language, setLanguage] = usePageLanguage()
  const [month] = useState(() => rankingMonth(new Date()))
  const copy = languageCopy[language]

  useEffect(() => {
    document.title = languageCopy[language].baseball.documentTitle
  }, [language])

  if (error)
    return (
      <main className="load-state">
        <p>{copy.baseball.loadError}</p>
        <small>{error}</small>
        <button className="primary-button compact" type="button" onClick={retry}>
          {copy.app.retry}
        </button>
      </main>
    )
  if (!town || !session)
    return (
      <main className="load-state" aria-busy="true">
        <span className="loader" aria-hidden="true" />
        <p role="status">{copy.baseball.loading}</p>
      </main>
    )

  if (needsCharacter(session))
    return (
      <main className="baseball-app">
        <Suspense
          fallback={
            <div className="creator-loading" role="status">
              <span className="loader" />
              <p>{copy.app.characterLoading}</p>
            </div>
          }
        >
          <CharacterCreator
            language={language}
            profile={normalizePlayerProfile(session.profile)}
            firstEntry
            submitLabel={copy.baseball.play}
            onApply={(profile) => save(withVenueProfile(session, profile))}
            onCancel={() => window.location.assign('/')}
            onActivateAudio={() => undefined}
          />
        </Suspense>
      </main>
    )

  const ballpark = town.venues.ballpark
  const rules = effectiveBallparkRules(ballpark, month)
  const upcoming = upcomingBallparkRules(ballpark, month)
  const venueCopy = copy.venues.ballpark
  return (
    <main className="baseball-app">
      <header className="baseball-header">
        <a className="baseball-back" href="/">
          <span aria-hidden="true">←</span> {copy.baseball.backToTown}
        </a>
        <LanguageSelect language={language} className="baseball-language-select" onChange={setLanguage} />
      </header>
      {/* A placeholder until the game: it shows the rules a run would play this KST month. */}
      <section className="baseball-card" aria-labelledby="baseball-title">
        <p className="eyebrow">{venueCopy.themes[ballpark.theme]}</p>
        <h1 id="baseball-title">{copy.baseball.title}</h1>
        <h2>{copy.baseball.rulesTitle}</h2>
        <ul className="baseball-rules">
          <li>{venueCopy.rulesThisMonth(rules.pitchCount, venueCopy.difficulties[rules.difficulty])}</li>
          {upcoming && (
            <li>
              {venueCopy.rulesFrom(
                monthName(upcoming.fromMonth, month, language),
                upcoming.rules.pitchCount,
                venueCopy.difficulties[upcoming.rules.difficulty],
              )}
            </li>
          )}
        </ul>
        <p className="baseball-note">{copy.baseball.comingSoon}</p>
      </section>
    </main>
  )
}
