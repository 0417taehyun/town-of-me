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
import { diagnoseStageEvent } from './devDiagnostics'
import { installDevSeam, queueDevSwing } from './devSeam'
import { browserDeviceBlock, type DeviceBlock } from './deviceGate'
import {
  createDerbyRun,
  createPracticeRun,
  DEFAULT_BATTING_SIDE,
  type DerbyFlow,
  type DerbyPlays,
  derbyStep,
  flowAfterEvent,
  pausedForAway,
  randomRunSeed,
  RULES_FLOW,
  setupFlow,
  shownPracticeFeedback,
  shownRun,
  stanceWait,
  startedFlow,
} from './flow/derbyFlow'
import { keepScreenOn, requestFullscreen } from './flow/screenRequests'
import type { StanceWatch } from './flow/stanceHold'
import { BaseballStage } from './stage/BaseballStage'
import type { RealTimeSwing, StageEvent } from './stage/stageRun'
import { CameraPanel } from './ui/CameraPanel'
import {
  cameraPanelLayout,
  cameraScreen,
  derbyKeyAction,
  nextPanelSize,
  PANEL_EDGE,
  readPanelSize,
  savePanelSize,
} from './ui/cameraPanelLayout'
import { DerbyHud } from './ui/DerbyHud'
import { DiagnosticsPanel } from './ui/DiagnosticsPanel'
import { betweenPitches, chasingHomeRun, derbySoundFor, hudAfterEvent, judgedResult, NEW_RUN_HUD } from './ui/derbyCues'
import { DeviceBlocked } from './ui/DeviceBlocked'
import { PracticeDoneView, PracticeView } from './ui/PracticeView'
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
    <header className={className}>
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
 * Dev builds only: the stand-in visitor and swings an automated check plays with (devSeam.ts), and the diagnostics
 * panel that D shows and L saves (devDiagnostics.ts), which hears when the stage judges a swing; none in production.
 */
const installDerbyDevSeam = import.meta.env.DEV ? installDevSeam : null
const queueDerbyDevSwing = import.meta.env.DEV ? queueDevSwing : null
const noteDerbyStageEvent = import.meta.env.DEV ? diagnoseStageEvent : null
const DerbyDiagnostics = import.meta.env.DEV ? DiagnosticsPanel : null

/**
 * The derby over its stadium, step by step (flow/derbyFlow.ts): the rules, then the camera's setup with its picture as
 * the stage, then practice, a run, its result, and another go, with the camera panel beside the play. The one click
 * on the rules card turns the camera on, unlocks the sounds, and asks for the full screen; the screen stays on while
 * the camera is (flow/screenRequests.ts). From then on the visitor goes on by holding the batting stance about three
 * seconds (flow/stanceHold.ts) or by the step's button, which takes focus so Enter or Space presses it. No key and no
 * button swings: the swings are the ones the camera sees (cameraTracking.ts), handed to the stage the moment they are
 * seen. Practice tells each swing only a bit early, good, or a bit late, and calibrates the runs after it; practice and
 * a run pause between pitches while the visitor is out of the camera's view. A camera that fails names its cause and
 * offers another try, and the derby cannot be played without it. The object detector rests from each windup until the
 * pitch is judged. A computer that tracks too slowly is blocked for the visit. Every run reads the KST month when it
 * starts, never when the page loaded. A `preview`, the admin's try of next month's rules, plays those scheduled (or
 * this month's when none are) and says so on every screen; it is never ranked. V (or the camera view button) resizes
 * or hides the camera panel beside the play, the "lock this object" button there and on the setup card locks what the
 * visitor holds, the result screen can turn the camera off, and Escape leaves from any of these screens: for the town,
 * or from a preview back to the editor.
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
  const gauge = useRef<HTMLDivElement>(null)
  const [flow, setFlow] = useState(RULES_FLOW)
  const [chosenSide, setChosenSide] = useState(DEFAULT_BATTING_SIDE)
  const [hud, setHud] = useState(NEW_RUN_HUD)
  const viewport = useViewportSize()
  const [panelSize, setPanelSize] = useState(readPanelSize)
  const side = flow.run?.log.side ?? chosenSide
  const cameraSwinging = flow.step === 'practice' || flow.step === 'play'
  const onCameraSwing = useCallback(
    (swing: RealTimeSwing) => {
      if (cameraSwinging) swings.current.push(swing)
    },
    [cameraSwinging],
  )
  const pitching = hud.phase === 'windup' || hud.phase === 'pitch'
  const rulesFor = preview ? plannedBallparkRules : effectiveBallparkRules
  const exit = baseballExit(preview)

  const begin = (next: DerbyFlow) => {
    swings.current = []
    setHud(NEW_RUN_HUD)
    setFlow(next)
  }
  const plays: DerbyPlays = {
    practice: () => createPracticeRun(ballpark, new Date(), side, rulesFor),
    run: (practice) => createDerbyRun(ballpark, new Date(), randomRunSeed(), { side, practice }, rulesFor),
  }
  // A go on a step that waits, by the held stance or its button.
  const start = () => {
    const next = startedFlow(flow, performance.now(), plays)
    if (next !== flow) begin(next)
  }
  const onStanceProgress = useCallback((progress: number) => {
    const ring = gauge.current
    if (!ring) return
    ring.style.setProperty('--stance-progress', String(progress))
    ring.setAttribute('aria-valuenow', String(Math.round(progress * 100)))
  }, [])
  const stance: StanceWatch = { wait: stanceWait(flow), onProgress: onStanceProgress, onHeld: start }
  const camera = useCameraTracking({ side, objectsPaused: cameraSwinging && pitching, onSwing: onCameraSwing, stance })
  const status = camera.status
  const step = derbyStep(flow, status.kind)
  const run = shownRun(flow, step)
  const cameraOn = isCameraOn(status)
  const screen = cameraScreen(cameraOn, step)
  const pitchCount = run?.plan.schedule.length ?? 0
  const paused = pausedForAway(step, camera.present, betweenPitches(hud, pitchCount))
  const searching = cameraOn && !camera.seen
  const panel = cameraPanelLayout({ screen, chasing: chasingHomeRun(hud), searching, size: panelSize }, viewport, side)
  const stateId = cameraStateId(status, camera.seen)
  // Once the camera sees the visitor, the swing tracker says what to do next.
  const trackerState = stateId === 'seen' && camera.caption ? cameraCopy.tracker[camera.caption] : null
  const cameraState = trackerState ?? (stateId && cameraCopy.states[stateId])
  const panelShown = panel.placement !== 'hidden'
  // A panel the visitor hid that is back while the camera looks for them says so, or V would seem to do nothing.
  const panelSizeLabel =
    panelSize === 'off' && panelShown ? cameraCopy.hiddenWhileSearching : cameraCopy.panelSizes[panelSize]
  const feedback =
    step === 'practice' && run ? shownPracticeFeedback(judgedResult(hud), run.plan.rules.difficulty) : null
  // A step that waits for the stance says so in a screen reader's ear, as practice and the run do in their captions.
  const waitsForStance = status.kind === 'ready' && step === flow.step && stanceWait(flow) !== null

  useEffect(() => () => sounds.dispose(), [sounds])
  useEffect(() => (cameraOn ? keepScreenOn() : undefined), [cameraOn])
  useEffect(() => installDerbyDevSeam?.(), [])

  const cyclePanelSize = useCallback(() => {
    const next = nextPanelSize(panelSize)
    savePanelSize(next)
    setPanelSize(next)
  }, [panelSize])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = derbyKeyAction(event, screen)
      if (action === 'leave') {
        window.location.assign(EXIT_PATHS[exit])
        return
      }
      if (action === 'cameraPanel') cyclePanelSize()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [screen, cyclePanelSize, exit])

  const onStageEvent = useCallback(
    (event: StageEvent) => {
      const at = performance.now()
      setHud((current) => hudAfterEvent(current, event))
      setFlow((current) => flowAfterEvent(current, event, at))
      const sound = derbySoundFor(event)
      if (sound) sounds.play(sound)
      queueDerbyDevSwing?.(event)
      noteDerbyStageEvent?.(event)
    },
    [sounds],
  )

  // The one click the derby needs: the camera, the sounds, and the full screen all need a click, so it asks for all.
  const startWithCamera = () => {
    sounds.unlock()
    requestFullscreen()
    begin(setupFlow(performance.now()))
    camera.turnOn()
  }

  if (status.kind === 'tooSlow')
    return (
      <>
        <BlockedPage block="slow" exit={exit} language={language} onLanguageChange={onLanguageChange} />
        {DerbyDiagnostics && <DerbyDiagnostics side={panel.side} />}
      </>
    )

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
        language={language}
        label={copy.baseball.stageLabel}
        profile={batter}
        palette={palette}
        side={side}
        run={run}
        swings={swings}
        onEvent={onStageEvent}
        band={panel.band}
        paused={paused}
        period={period}
        season={season}
        reducedMotion={reducedMotion}
        onUnavailable={onGraphicsUnavailable}
      />
      <p className="derby-step-caption" role="status">
        {waitsForStance ? copy.baseball.flow.stance : null}
      </p>
      <CameraPanel
        video={camera.video}
        canvas={camera.canvas}
        layout={panel}
        state={cameraState}
        seen={camera.seen}
        onTap={camera.lockAt}
      />
      {step === 'practice' && run && (
        <PracticeView
          hud={hud}
          pitchCount={pitchCount}
          feedback={feedback}
          paused={paused}
          language={language}
          cameraState={cameraState}
        />
      )}
      {step === 'practiceDone' && (
        <PracticeDoneView gauge={gauge} language={language} cameraState={cameraState} onPlay={start} />
      )}
      {(step === 'play' || step === 'result') && run && (
        <DerbyHud hud={hud} pitchCount={pitchCount} paused={paused} language={language} cameraState={cameraState} />
      )}
      {step === 'setup' && status.kind !== 'off' && (
        <SetupView
          status={status}
          cameraState={cameraState}
          panelSide={panel.side}
          side={side}
          freeMode={camera.freeMode}
          gauge={gauge}
          language={language}
          onSideChange={setChosenSide}
          onStart={start}
          onRetry={startWithCamera}
          onTurnOff={camera.turnOff}
          onLockHeld={() => camera.lockAt(null)}
          onToggleFreeMode={camera.toggleFreeMode}
        />
      )}
      {step === 'rules' && (
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
          {status.kind === 'off' && status.stoppedBy && (
            <p className="baseball-note derby-camera-stopped" role="status">
              {cameraCopy.stopped[status.stoppedBy]}
            </p>
          )}
          <p className="baseball-note">{cameraCopy.notice}</p>
          <p className="baseball-note">{copy.baseball.leaveKey}</p>
          <div className="derby-actions">
            <button className="primary-button" type="button" autoFocus onClick={startWithCamera}>
              {cameraCopy.turnOn}
            </button>
          </div>
        </section>
      )}
      {step === 'result' && flow.result && (
        <ResultView result={flow.result} exit={exit} gauge={gauge} language={language} onPlayAgain={start} />
      )}
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
      {DerbyDiagnostics && <DerbyDiagnostics side={panel.side} />}
    </main>
  )
}
