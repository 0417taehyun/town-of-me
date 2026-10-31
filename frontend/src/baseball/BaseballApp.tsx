import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createDerbySounds } from '../audio/derbySounds'
import { effectiveBallparkRules, rankingMonth, upcomingBallparkRules } from '../data/ballparkRules'
import { InMemoryDemoRepository } from '../data/InMemoryDemoRepository'
import type { BallparkSettings } from '../data/models'
import { normalizePlayerProfile, type PlayerProfile } from '../data/playerProfile'
import { fetchTownLayout } from '../data/townApi'
import { useDemoSession } from '../hooks/useDemoSession'
import { useLocalEnvironment } from '../hooks/useLocalEnvironment'
import { usePageLanguage } from '../hooks/usePageLanguage'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { type AppLanguage, languageCopy, monthName } from '../i18n/language'
import { resolveBallparkPalette } from '../scene/venues/ballpark/ballparkThemes'
import { LanguageSelect } from '../ui/LanguageSelect'
import { needsCharacter, withVenueProfile } from './baseballSession'
import { browserDeviceBlock } from './deviceGate'
import type { DerbyResult } from './game/derbyScore'
import { createKeyboardRun, DEFAULT_BATTING_SIDE, isSwingKey, keyboardSwing, randomRunSeed } from './keyboardRun'
import { BaseballStage } from './stage/BaseballStage'
import type { RealTimeSwing, StageEvent, StageRunSetup } from './stage/stageRun'
import { DerbyHud } from './ui/DerbyHud'
import { derbySoundFor, hudAfterEvent, NEW_RUN_HUD } from './ui/derbyCues'
import { DeviceBlocked } from './ui/DeviceBlocked'
import { ResultView } from './ui/ResultView'
import './baseball.css'

const CharacterCreator = lazy(() =>
  import('../ui/CharacterCreator').then((module) => ({ default: module.CharacterCreator })),
)

/** The home run derby page: the same town and tab session as the town, so a visitor plays as their character. */
export function BaseballApp({ townId }: { townId: string }) {
  const [repository] = useState(() => new InMemoryDemoRepository(fetchTownLayout))
  const { town, session, error, save, retry } = useDemoSession(repository, townId)
  const [language, setLanguage] = usePageLanguage()
  // Phones and browsers without WebGL 2 stop here, before a character or the stadium could be made; so does a stadium
  // whose graphics fail or are lost later.
  const [block, setBlock] = useState(browserDeviceBlock)
  const blockGraphics = useCallback(() => setBlock('graphics'), [])
  const copy = languageCopy[language]

  useEffect(() => {
    document.title = languageCopy[language].baseball.documentTitle
  }, [language])

  if (block)
    return (
      <main className="baseball-app">
        <BaseballLinks className="baseball-header" language={language} onLanguageChange={setLanguage} />
        <DeviceBlocked block={block} language={language} />
      </main>
    )
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

  return (
    <DerbyScreen
      ballpark={town.venues.ballpark}
      profile={session.profile}
      language={language}
      onLanguageChange={setLanguage}
      onGraphicsUnavailable={blockGraphics}
    />
  )
}

/** The way back to the town and the language choice, on every screen of the page. */
export function BaseballLinks({
  className,
  language,
  onLanguageChange,
}: {
  className: string
  language: AppLanguage
  onLanguageChange: (language: AppLanguage) => void
}) {
  return (
    // A pointer leaves no focus behind here, so the next Space or Enter swings instead of pressing a link or language
    // button again; focus the keyboard put here stays.
    <header
      className={className}
      onPointerUp={() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      }}
    >
      <a className="baseball-back" href="/">
        <span aria-hidden="true">←</span> {languageCopy[language].baseball.backToTown}
      </a>
      <LanguageSelect language={language} className="baseball-language-select" onChange={onLanguageChange} />
    </header>
  )
}

/**
 * The derby over its stadium: the rules and a play button, then a keyboard run, then its result and another go. Every
 * run reads the KST month when it starts, never when the page loaded. Space or Enter swings while a run plays, and
 * Escape goes back to the town from any of these screens.
 */
export function DerbyScreen({
  ballpark,
  profile,
  language,
  onLanguageChange,
  onGraphicsUnavailable,
}: {
  ballpark: BallparkSettings
  profile: PlayerProfile | undefined
  language: AppLanguage
  onLanguageChange: (language: AppLanguage) => void
  onGraphicsUnavailable: () => void
}) {
  const copy = languageCopy[language]
  const venueCopy = copy.venues.ballpark
  const reducedMotion = useReducedMotion()
  const { period, season } = useLocalEnvironment()
  const palette = useMemo(() => resolveBallparkPalette(ballpark), [ballpark])
  const batter = useMemo(() => normalizePlayerProfile(profile), [profile])
  const [sounds] = useState(() => createDerbySounds())
  const swings = useRef<RealTimeSwing[]>([])
  const [run, setRun] = useState<StageRunSetup | null>(null)
  const [hud, setHud] = useState(NEW_RUN_HUD)
  const [result, setResult] = useState<DerbyResult | null>(null)
  const playing = run !== null && result === null

  useEffect(() => () => sounds.dispose(), [sounds])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.location.assign('/')
        return
      }
      if (!playing || !isSwingKey(event)) return
      // Keeps a focused button from also taking the key, and Space from scrolling.
      event.preventDefault()
      swings.current.push(keyboardSwing(event.timeStamp))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playing])

  const onStageEvent = useCallback(
    (event: StageEvent) => {
      setHud((current) => hudAfterEvent(current, event))
      const sound = derbySoundFor(event)
      if (sound) sounds.play(sound)
      if (event.type === 'finished') setResult(event.result)
    },
    [sounds],
  )

  // The click that starts a run is also the gesture that lets the browser start its sounds.
  const startRun = () => {
    sounds.unlock()
    swings.current = []
    setHud(NEW_RUN_HUD)
    setResult(null)
    setRun(createKeyboardRun(ballpark, new Date(), randomRunSeed()))
  }

  const month = rankingMonth(new Date())
  const rules = effectiveBallparkRules(ballpark, month)
  const upcoming = upcomingBallparkRules(ballpark, month)
  return (
    <main className="derby-screen">
      <BaseballStage
        label={copy.baseball.stageLabel}
        profile={batter}
        palette={palette}
        side={run?.log.side ?? DEFAULT_BATTING_SIDE}
        run={run}
        swings={swings}
        onEvent={onStageEvent}
        period={period}
        season={season}
        reducedMotion={reducedMotion}
        onUnavailable={onGraphicsUnavailable}
      />
      {run && (
        <DerbyHud
          hud={hud}
          pitchCount={run.plan.schedule.length}
          language={language}
          onSwing={(timeStamp) => swings.current.push(keyboardSwing(timeStamp))}
        />
      )}
      {!run && (
        <section className="baseball-card derby-start" aria-labelledby="baseball-title">
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
          <p className="baseball-note">{copy.baseball.controls}</p>
          <div className="derby-actions">
            <button className="primary-button" type="button" autoFocus onClick={startRun}>
              {copy.baseball.play}
            </button>
          </div>
        </section>
      )}
      {result && <ResultView result={result} language={language} onPlayAgain={startRun} />}
      <BaseballLinks className="baseball-header derby-links" language={language} onLanguageChange={onLanguageChange} />
    </main>
  )
}
