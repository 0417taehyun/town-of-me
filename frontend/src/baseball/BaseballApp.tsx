import {
  type CSSProperties,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createDerbySounds } from '../audio/derbySounds'
import {
  effectiveBallparkRules,
  plannedBallparkRules,
  rankingMonth,
  upcomingBallparkRules,
} from '../data/ballparkRules'
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
import { type BaseballExit, baseballExit, EXIT_PATHS, isNextRulesPreview } from './baseballRoute'
import { needsCharacter, withVenueProfile } from './baseballSession'
import { cameraStateId, isCameraOn, useCameraTracking } from './cameraTracking'
import { browserDeviceBlock, type DeviceBlock } from './deviceGate'
import type { DerbyInput, DerbyResult } from './game/derbyScore'
import { createDerbyRun, DEFAULT_BATTING_SIDE, isSwingKey, keyboardSwing, randomRunSeed } from './keyboardRun'
import { BaseballStage } from './stage/BaseballStage'
import type { RealTimeSwing, StageEvent, StageRunSetup } from './stage/stageRun'
import { CameraPanel } from './ui/CameraPanel'
import {
  cameraPanelLayout,
  cameraScreen,
  isCameraPanelKey,
  nextPanelSize,
  PANEL_EDGE,
  readPanelSize,
  savePanelSize,
} from './ui/cameraPanelLayout'
import { DerbyHud } from './ui/DerbyHud'
import { chasingHomeRun, derbySoundFor, hudAfterEvent, NEW_RUN_HUD } from './ui/derbyCues'
import { DeviceBlocked } from './ui/DeviceBlocked'
import { ResultView } from './ui/ResultView'
import { SetupView } from './ui/SetupView'
import { useViewportSize } from './ui/useViewportSize'
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
  const preview = isNextRulesPreview(window.location.search)
  const exit = baseballExit(preview)

  useEffect(() => {
    document.title = languageCopy[language].baseball.documentTitle
  }, [language])

  if (block) return <BlockedPage block={block} exit={exit} language={language} onLanguageChange={setLanguage} />
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
            onCancel={() => window.location.assign(EXIT_PATHS[exit])}
            onActivateAudio={() => undefined}
          />
        </Suspense>
      </main>
    )

  return (
    <DerbyScreen
      ballpark={town.venues.ballpark}
      preview={preview}
      profile={session.profile}
      language={language}
      onLanguageChange={setLanguage}
      onGraphicsUnavailable={blockGraphics}
    />
  )
}

/**
 * The way back (to the town, or from a preview to the editor) and the language choice on every screen of the page,
 * beside any note in `children`.
 */
export function BaseballLinks({
  className,
  exit,
  language,
  onLanguageChange,
  children,
}: {
  className: string
  exit: BaseballExit
  language: AppLanguage
  onLanguageChange: (language: AppLanguage) => void
  children?: ReactNode
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
      <a className="baseball-back" href={EXIT_PATHS[exit]}>
        <span aria-hidden="true">←</span> {languageCopy[language].baseball.back[exit]}
      </a>
      <LanguageSelect language={language} className="baseball-language-select" onChange={onLanguageChange} />
      {children}
    </header>
  )
}

/** The page for a device the derby cannot be played on, with the way back and the language choice. */
export function BlockedPage({
  block,
  exit,
  language,
  onLanguageChange,
}: {
  block: DeviceBlock
  exit: BaseballExit
  language: AppLanguage
  onLanguageChange: (language: AppLanguage) => void
}) {
  return (
    <main className="baseball-app">
      <BaseballLinks className="baseball-header" exit={exit} language={language} onLanguageChange={onLanguageChange} />
      <DeviceBlocked block={block} language={language} />
    </main>
  )
}

/**
 * The derby over its stadium: the rules, then the camera's setup with its picture as the stage, then a camera run with
 * the camera panel beside the play, then its result and another go. The keyboard run the rules card still offers takes
 * Space or Enter as swings; a camera run takes no key: its swings are the ones the camera sees (cameraTracking.ts),
 * handed to the stage the moment they are seen, and a camera that fails names its cause and offers another try, never
 * the keyboard. The object detector rests from each windup until the pitch is judged. A computer that tracks too
 * slowly is blocked for the visit. Every run reads the KST month when it starts, never when the page loaded. A
 * `preview`, the admin's try of next month's rules, plays those scheduled (or this month's when none are) and says so
 * on every screen; it is never ranked. V (or the camera view button) resizes or hides the camera panel during a camera
 * run, the "lock this object" button there and on the setup card locks what the visitor holds, the result screen can
 * turn the camera off, and Escape leaves from any of these screens: for the town, or from a preview back to the editor.
 */
export function DerbyScreen({
  ballpark,
  preview,
  profile,
  language,
  onLanguageChange,
  onGraphicsUnavailable,
}: {
  ballpark: BallparkSettings
  preview: boolean
  profile: PlayerProfile | undefined
  language: AppLanguage
  onLanguageChange: (language: AppLanguage) => void
  onGraphicsUnavailable: () => void
}) {
  const copy = languageCopy[language]
  const venueCopy = copy.venues.ballpark
  const cameraCopy = copy.baseball.camera
  const reducedMotion = useReducedMotion()
  const { period, season } = useLocalEnvironment()
  const palette = useMemo(() => resolveBallparkPalette(ballpark), [ballpark])
  const batter = useMemo(() => normalizePlayerProfile(profile), [profile])
  const [sounds] = useState(() => createDerbySounds())
  const swings = useRef<RealTimeSwing[]>([])
  const [run, setRun] = useState<StageRunSetup | null>(null)
  const [hud, setHud] = useState(NEW_RUN_HUD)
  const [result, setResult] = useState<DerbyResult | null>(null)
  const side = run?.log.side ?? DEFAULT_BATTING_SIDE
  const keyboardPlaying = run?.log.input === 'keyboard' && result === null
  const cameraPlaying = run?.log.input === 'camera' && result === null
  const onCameraSwing = useCallback(
    (swing: RealTimeSwing) => {
      if (cameraPlaying) swings.current.push(swing)
    },
    [cameraPlaying],
  )
  const pitching = hud.phase === 'windup' || hud.phase === 'pitch'
  const camera = useCameraTracking({ side, objectsPaused: cameraPlaying && pitching, onSwing: onCameraSwing })
  const viewport = useViewportSize()
  const [panelSize, setPanelSize] = useState(readPanelSize)
  const rulesFor = preview ? plannedBallparkRules : effectiveBallparkRules
  const exit = baseballExit(preview)
  const cameraOn = isCameraOn(camera.status)
  const screen = cameraScreen(cameraOn, run !== null, result !== null)
  const searching = cameraOn && !camera.seen
  const panel = cameraPanelLayout({ screen, chasing: chasingHomeRun(hud), searching, size: panelSize }, viewport, side)
  const stateId = cameraStateId(camera.status, camera.seen)
  // Once the camera sees the visitor, the swing tracker says what to do next.
  const trackerState = stateId === 'seen' && camera.caption ? cameraCopy.tracker[camera.caption] : null
  const cameraState = trackerState ?? (stateId && cameraCopy.states[stateId])
  const panelShown = panel.placement !== 'hidden'
  // A panel the visitor hid that is back while the camera looks for them says so, or V would seem to do nothing.
  const panelSizeLabel =
    panelSize === 'off' && panelShown ? cameraCopy.hiddenWhileSearching : cameraCopy.panelSizes[panelSize]

  useEffect(() => () => sounds.dispose(), [sounds])

  const cyclePanelSize = useCallback(() => {
    const next = nextPanelSize(panelSize)
    savePanelSize(next)
    setPanelSize(next)
  }, [panelSize])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.location.assign(EXIT_PATHS[exit])
        return
      }
      if (screen === 'play' && isCameraPanelKey(event)) cyclePanelSize()
      if (!keyboardPlaying || !isSwingKey(event)) return
      // Keeps a focused button from also taking the key, and Space from scrolling.
      event.preventDefault()
      swings.current.push(keyboardSwing(event.timeStamp))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboardPlaying, screen, cyclePanelSize, exit])

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
  const startRun = (input: DerbyInput) => {
    sounds.unlock()
    swings.current = []
    setHud(NEW_RUN_HUD)
    setResult(null)
    setRun(createDerbyRun(ballpark, new Date(), randomRunSeed(), input, rulesFor))
  }
  // A camera run plays again only while the camera is still on; otherwise the camera's card says why it is off.
  const playAgain = () => {
    const input = run?.log.input ?? 'camera'
    if (input === 'keyboard' || camera.status.kind === 'ready') return startRun(input)
    setRun(null)
    setResult(null)
  }

  const status = camera.status
  if (status.kind === 'tooSlow')
    return <BlockedPage block="slow" exit={exit} language={language} onLanguageChange={onLanguageChange} />

  const month = rankingMonth(new Date())
  const rules = effectiveBallparkRules(ballpark, month)
  const upcoming = upcomingBallparkRules(ballpark, month)
  // The HUD's caption and banner centre in the band the camera panel leaves free, as the play does, and size to it.
  const layoutStyle = {
    '--play-centre': `${panel.band.centre}px`,
    '--play-width': `${panel.band.width}px`,
    '--camera-panel-edge': `${PANEL_EDGE}px`,
  } as CSSProperties
  return (
    <main className="derby-screen" style={layoutStyle}>
      <BaseballStage
        label={copy.baseball.stageLabel}
        profile={batter}
        palette={palette}
        side={side}
        run={run}
        swings={swings}
        onEvent={onStageEvent}
        band={panel.band}
        period={period}
        season={season}
        reducedMotion={reducedMotion}
        onUnavailable={onGraphicsUnavailable}
      />
      <CameraPanel
        video={camera.video}
        canvas={camera.canvas}
        layout={panel}
        state={cameraState}
        seen={camera.seen}
        onTap={camera.lockAt}
      />
      {run && (
        <DerbyHud
          hud={hud}
          pitchCount={run.plan.schedule.length}
          language={language}
          cameraState={run.log.input === 'camera' ? cameraState : null}
          onSwing={run.log.input === 'keyboard' ? (timeStamp) => swings.current.push(keyboardSwing(timeStamp)) : null}
        />
      )}
      {!run && status.kind !== 'off' && (
        <SetupView
          status={status}
          cameraState={cameraState}
          panelSide={panel.side}
          freeMode={camera.freeMode}
          language={language}
          onPlay={() => startRun('camera')}
          onRetry={camera.turnOn}
          onTurnOff={camera.turnOff}
          onLockHeld={() => camera.lockAt(null)}
          onToggleFreeMode={camera.toggleFreeMode}
        />
      )}
      {!run && status.kind === 'off' && (
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
          {preview && (
            <p className="baseball-note derby-preview-note">
              {upcoming
                ? venueCopy.previewPlays(monthName(upcoming.fromMonth, month, language))
                : venueCopy.previewCurrent}
            </p>
          )}
          {status.stoppedBy && (
            <p className="baseball-note derby-camera-stopped" role="status">
              {cameraCopy.stopped[status.stoppedBy]}
            </p>
          )}
          <p className="baseball-note">{cameraCopy.notice}</p>
          <div className="derby-actions">
            <button className="primary-button" type="button" autoFocus onClick={camera.turnOn}>
              {cameraCopy.turnOn}
            </button>
          </div>
          {/* The keyboard run, until the camera-only change removes it; its keys are told beside it, not the camera's. */}
          <p className="baseball-note derby-keyboard-play">
            <button className="derby-secondary" type="button" onClick={() => startRun('keyboard')}>
              {copy.baseball.play}
            </button>
            {copy.baseball.controls}
          </p>
        </section>
      )}
      {result && <ResultView result={result} exit={exit} language={language} onPlayAgain={playAgain} />}
      <BaseballLinks
        className="baseball-header derby-links"
        exit={exit}
        language={language}
        onLanguageChange={onLanguageChange}
      >
        {screen === 'play' && (
          <button
            className="derby-camera-toggle"
            type="button"
            aria-pressed={panelShown}
            aria-keyshortcuts="V"
            onClick={cyclePanelSize}
          >
            {cameraCopy.panel}
            <span aria-hidden="true">{panelSizeLabel}</span>
            <kbd aria-hidden="true">V</kbd>
          </button>
        )}
        {screen === 'play' && !camera.freeMode && (
          <button className="derby-camera-toggle" type="button" onClick={() => camera.lockAt(null)}>
            {cameraCopy.lockHeld}
          </button>
        )}
        {/* The panel is hidden here while the camera stays on for another go, so the way to turn it off is too. */}
        {screen === 'result' && (
          <button className="derby-camera-toggle" type="button" onClick={camera.turnOff}>
            {cameraCopy.turnOff}
          </button>
        )}
        {preview && <p className="derby-preview-badge">{venueCopy.previewBadge}</p>}
      </BaseballLinks>
    </main>
  )
}
