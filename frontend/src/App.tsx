import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { CAMERA_DEFAULTS, type CameraSettings } from './camera/cameraConfig'
import { cameraHeightForFov } from './camera/cameraMath'
import { useCozyBgm } from './audio/useCozyBgm'
import { signOut } from './data/adminSession'
import { InMemoryDemoRepository } from './data/InMemoryDemoRepository'
import type { TownGuideStep, Vec3 } from './data/models'
import { fetchTownLayout } from './data/townApi'
import type { EditorCategory } from './editor/objectSelection'
import type { EditorView } from './editor/townEditing'
import { isAdminPath, useAdminAccess } from './editor/useAdminAccess'
import { useTownEditor } from './editor/useTownEditor'
import { createVisitorSession, useDemoSession } from './hooks/useDemoSession'
import { useReducedMotion } from './hooks/useReducedMotion'
import { DEFAULT_PLAYER_PROFILE, normalizePlayerProfile, type PlayerProfile } from './data/playerProfile'
import { answerOwnerQuestion, answerResidentQuestion, type ResidentQuestionId } from './data/residentDialogue'
import { getPreferredLanguage, languageCopy } from './i18n/language'
import type { DialogueMessage, Interaction, InteractionRequest } from './scene/playerInteraction'
import { getDayPeriod, type DayPeriod } from './scene/environment/dayCycle'
import { getSeason, type Season } from './scene/environment/season'
import { nextTownGuideStep, type TownGuideEvent } from './data/townGuide'
import { getGroundSurface, getTownPlaza } from './scene/environment/groundSurface'
import { getTownRoads } from './scene/objects/roads/roadLayout'
import { Dialogue, InteractionPrompt, Toast } from './ui/OverlayUI'
import { useDialogueReveal } from './ui/useDialogueReveal'
import { EntryOverlay } from './ui/EntryOverlay'
import { OwnerIntroduction } from './ui/OwnerIntroduction'
import { EnvironmentTuner, HelpPanel, Hud } from './ui/TownHud'
import { VirtualStick } from './ui/TouchControls'
import { TownLoadingScreen } from './ui/TownLoadingScreen'
import { TownMapPanel } from './ui/TownMapPanel'

const TownScene = lazy(() => import('./scene/TownScene').then((module) => ({ default: module.TownScene })))
const CharacterCreator = lazy(() =>
  import('./ui/CharacterCreator').then((module) => ({ default: module.CharacterCreator })),
)
const GuestbookBoard = lazy(() => import('./ui/GuestbookPanel').then((module) => ({ default: module.GuestbookBoard })))
const AdminGate = lazy(() => import('./editor/AdminGate').then((module) => ({ default: module.AdminGate })))
const TownEditorPanel = lazy(() =>
  import('./editor/TownEditorPanel').then((module) => ({ default: module.TownEditorPanel })),
)
const TownEditorScene = lazy(() =>
  import('./editor/TownEditorScene').then((module) => ({ default: module.TownEditorScene })),
)

const TOWN_ID = 'mossbell'

type HudPanel = 'environment' | 'help' | 'map' | null

export function App() {
  const [repository] = useState(() => new InMemoryDemoRepository((townId) => fetchTownLayout(townId)))
  const { town, session, error, save, retry } = useDemoSession(repository, TOWN_ID)
  const [adminMode] = useState(() => isAdminPath(window.location.pathname))
  const [loginFailed] = useState(() => new URLSearchParams(window.location.search).get('login') === 'failed')
  const adminAccess = useAdminAccess(adminMode)
  const editor = useTownEditor(adminAccess.status === 'admin' ? TOWN_ID : null)
  const editorViewCenter = useRef(new Vector3(0, 0, 4))
  const [editorView, setEditorView] = useState<EditorView>('top')
  const [editorCategory, setEditorCategory] = useState<EditorCategory>('buildings')
  const [editorSelecting, setEditorSelecting] = useState(false)
  const editorFocusRef = useRef<Vec3 | null>(null)
  const [language, setLanguage] = useState(getPreferredLanguage)
  const [sceneReady, setSceneReady] = useState(false)
  const [sceneProgress, setSceneProgress] = useState(0)
  const [loadingVisible, setLoadingVisible] = useState(true)
  const [entered, setEntered] = useState(false)
  const [profile, setProfile] = useState<PlayerProfile>({ ...DEFAULT_PLAYER_PROFILE })
  const [creatorOpen, setCreatorOpen] = useState(false)
  // Stays set while the character creator is open, so the creator's back action returns to it.
  const [introductionOpen, setIntroductionOpen] = useState(false)
  const [guestbookOpen, setGuestbookOpen] = useState(false)
  const [guideStep, setGuideStep] = useState<TownGuideStep>('inactive')
  const [ambientMotion, setAmbientMotion] = useState(true)
  const [settings, setSettings] = useState<CameraSettings>(CAMERA_DEFAULTS)
  const [spawn, setSpawn] = useState<Vec3>({ x: 0, y: 1.2, z: 4 })
  const [hudPanel, setHudPanel] = useState<HudPanel>(null)
  const [debug, setDebug] = useState(false)
  const [interacted, setInteracted] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [photoRequest, setPhotoRequest] = useState(0)
  const [playerResetKey, setPlayerResetKey] = useState(0)
  const [cameraResetKey, setCameraResetKey] = useState(0)
  const playerPosition = useRef(new Vector3(0, 1.2, 4))
  const touchMovement = useRef({ x: 0, y: 0 })
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const [interactionRequest, setInteractionRequest] = useState<InteractionRequest>(null)
  const [dialogue, setDialogue] = useState<DialogueMessage | null>(null)
  const initialized = useRef(false)
  const toastTimer = useRef<number | undefined>(undefined)
  const ownerReferenceReady = useRef(false)
  const reducedMotion = useReducedMotion()
  const [localPeriod, setLocalPeriod] = useState(() => getDayPeriod(new Date()))
  const [localSeason, setLocalSeason] = useState(() => getSeason(new Date()))
  const [periodPreview, setPeriodPreview] = useState<DayPeriod | 'local'>('local')
  const [seasonPreview, setSeasonPreview] = useState<Season | 'local'>('local')
  const period = periodPreview === 'local' ? localPeriod : periodPreview
  const season = seasonPreview === 'local' ? localSeason : seasonPreview
  const previewingEnvironment = periodPreview !== 'local' || seasonPreview !== 'local'
  const bgm = useCozyBgm(period)
  const speakDialogue = bgm.speak
  const stopSpeaking = bgm.stopSpeaking
  const dialogueReveal = useDialogueReveal(dialogue, reducedMotion)
  const finishDialogueLine = dialogueReveal.finish
  const dialogueTyping = dialogueReveal.revealTimes !== null
  const copy = languageCopy[language]
  const markSceneReady = useCallback(() => {
    setSceneProgress(100)
    setSceneReady(true)
  }, [])
  const updateSceneProgress = useCallback((progress: number) => setSceneProgress(progress), [])
  const finishLoading = useCallback(() => setLoadingVisible(false), [])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    if (dialogue?.voice !== 'resident') {
      stopSpeaking()
      return
    }
    void speakDialogue(dialogue.text, dialogue.speaker)
    return stopSpeaking
  }, [dialogue, speakDialogue, stopSpeaking])

  useEffect(() => {
    const update = () => {
      const currentDate = new Date()
      setLocalPeriod(getDayPeriod(currentDate))
      setLocalSeason(getSeason(currentDate))
    }
    const timer = window.setInterval(update, 30000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  useEffect(() => {
    if (!session || initialized.current) return
    initialized.current = true
    setSettings(session.camera)
    setSpawn(session.playerPosition)
    Object.assign(playerPosition.current, session.playerPosition)
    setEntered(session.ui.instructionsDismissed)
    setProfile(normalizePlayerProfile(session.profile))
    setGuideStep(session.ui.guideStep ?? 'inactive')
  }, [session])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('login')) return
    url.searchParams.delete('login')
    window.history.replaceState(null, '', url)
  }, [])

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const respawn = useCallback(() => {
    if (!town) return
    setSpawn({ ...town.spawn })
    setPlayerResetKey((key) => key + 1)
    setCameraResetKey((key) => key + 1)
    showToast(copy.app.backAtPlaza)
  }, [copy.app.backAtPlaza, showToast, town])

  const requestInteraction = useCallback(
    (action: 'interact' | 'greet') => {
      // Talking while a line is still typing shows the whole line instead of starting the conversation over.
      if (action === 'interact' && dialogueTyping) {
        finishDialogueLine()
        stopSpeaking()
        return
      }
      setInteractionRequest((current) => ({ sequence: (current?.sequence ?? 0) + 1, action }))
    },
    [dialogueTyping, finishDialogueLine, stopSpeaking],
  )

  const requestPhoto = useCallback(() => setPhotoRequest((request) => request + 1), [])
  const saveGuideStep = useCallback(
    (nextStep: TownGuideStep) => {
      if (!town) return
      setGuideStep(nextStep)
      void save(createVisitorSession(town.id, playerPosition.current, settings, profile, nextStep))
    },
    [profile, save, settings, town],
  )
  const handleGuideEvent = useCallback(
    (event: TownGuideEvent) => {
      if (!town) return
      // The owner is never asked what kind of person they are, so only other residents can finish that lesson.
      const hasResidents = town.residents.some(({ id }) => id !== town.owner.residentId)
      const nextStep = nextTownGuideStep(guideStep, event, hasResidents)
      if (nextStep === guideStep) return
      saveGuideStep(nextStep)
    },
    [guideStep, saveGuideStep, town],
  )
  const askResidentQuestion = useCallback(
    (questionId: ResidentQuestionId) => {
      const resident = town?.residents.find(({ id }) => id === dialogue?.actorId)
      if (!dialogue?.choices || !town || !resident) return
      const asked = dialogue.asked ?? []
      const reply =
        resident.id === town.owner.residentId
          ? answerOwnerQuestion(town.owner, questionId, asked, language)
          : answerResidentQuestion(resident, questionId, asked, language, town.owner.name[language])
      setDialogue({
        ...dialogue,
        text: reply.text,
        link: reply.link,
        choices: reply.choices.length ? reply.choices : undefined,
        asked: reply.asked,
        voice: 'resident',
      })
      if (questionId === 'about-owner') ownerReferenceReady.current = true
    },
    [dialogue, language, town],
  )
  const handleDialogueChange = useCallback(
    (message: DialogueMessage | null) => {
      if (message) {
        setDialogue(message)
        return
      }
      const completedReference = ownerReferenceReady.current
      ownerReferenceReady.current = false
      setDialogue(null)
      if (completedReference) handleGuideEvent('heard-owner-reference')
    },
    [handleGuideEvent],
  )
  const finishPhotoCapture = useCallback(
    (saved: boolean) => {
      showToast(saved ? copy.app.photoSaved : copy.app.photoError)
      handleGuideEvent('tried-photo')
    },
    [copy.app.photoError, copy.app.photoSaved, handleGuideEvent, showToast],
  )
  const showHouseUnavailable = useCallback(
    () => showToast(copy.app.houseUnavailable),
    [copy.app.houseUnavailable, showToast],
  )
  const closeGuestbook = useCallback(() => {
    setGuestbookOpen(false)
    if (guestbookOpen && guideStep === 'guestbook') handleGuideEvent('visited-guestbook')
  }, [guestbookOpen, guideStep, handleGuideEvent])

  useEffect(() => {
    if (adminMode || !entered || creatorOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, button, textarea, select')) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault()
      if (event.code === 'KeyH' && !event.repeat) setDebug((value) => !value)
      if (event.code === 'KeyR' && !event.repeat) respawn()
      if (event.code === 'KeyC' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) requestPhoto()
      if (event.code === 'KeyE' && !event.repeat && interaction) requestInteraction('interact')
      if (event.code === 'KeyG' && !event.repeat && interaction?.actorId === 'pet') requestInteraction('greet')
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        setInteracted(true)
      }
      if (event.key === 'Escape') {
        setHudPanel(null)
        closeGuestbook()
      }
    }
    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [adminMode, closeGuestbook, creatorOpen, entered, interaction, requestInteraction, requestPhoto, respawn])

  const signOutAdmin = useCallback(() => {
    void signOut()
      .catch(() => undefined)
      .finally(adminAccess.refresh)
  }, [adminAccess.refresh])

  const changeFov = useCallback((fov: number) => {
    setSettings((current) => ({ ...current, fov, height: cameraHeightForFov(fov) }))
  }, [])

  if (error)
    return (
      <main className="load-state">
        <p>{copy.app.loadError}</p>
        <small>{error}</small>
        <button className="primary-button compact" type="button" onClick={retry}>
          {copy.app.retry}
        </button>
      </main>
    )
  if (!town || !session)
    return (
      <main className="app-shell">
        {loadingVisible && <TownLoadingScreen language={language} ready={false} progress={sceneProgress} />}
      </main>
    )

  const editedTown = editor.town
  const ownerName = town.owner.name[language]
  const petName = town.pet.name[language]
  const applyProfile = async (nextProfile: PlayerProfile) => {
    const nextGuideStep = entered ? guideStep : 'move'
    await save(createVisitorSession(town.id, playerPosition.current, settings, nextProfile, nextGuideStep))
    setProfile(nextProfile)
    setGuideStep(nextGuideStep)
    setEntered(true)
    setCreatorOpen(false)
    showToast(`${copy.app.welcome}, ${nextProfile.name}`)
  }
  const enterAsGuest = () => {
    bgm.startAfterEntry()
    if (town.owner.introduction) {
      setIntroductionOpen(true)
      return
    }
    setCreatorOpen(true)
  }
  // Left out while the creator is open, so closing the creator remounts this card and focus returns to its button.
  const guestEntry =
    introductionOpen && town.owner.introduction ? (
      <OwnerIntroduction
        language={language}
        ownerName={ownerName}
        introduction={town.owner.introduction[language]}
        contactEmail={town.owner.contactEmail}
        onLanguageChange={setLanguage}
        onContinue={() => setCreatorOpen(true)}
      />
    ) : (
      <EntryOverlay
        language={language}
        ownerName={ownerName}
        onLanguageChange={setLanguage}
        onActivateAudio={bgm.startAfterEntry}
        onEnter={enterAsGuest}
      />
    )

  return (
    <main className="app-shell">
      {loadingVisible && (
        <TownLoadingScreen language={language} ready={sceneReady} progress={sceneProgress} onFinished={finishLoading} />
      )}
      <div className="scene-layer">
        <Suspense fallback={null}>
          <TownScene
            profile={profile}
            onAmbience={bgm.setAmbience}
            controlsEnabled={
              !adminMode && entered && !creatorOpen && !guestbookOpen && !loadingVisible && hudPanel === null
            }
            town={editedTown ?? town}
            spawn={spawn}
            settings={settings}
            debug={debug}
            playerResetKey={playerResetKey}
            cameraResetKey={cameraResetKey}
            playerPosition={playerPosition}
            reducedMotion={reducedMotion}
            ambientMotion={ambientMotion}
            period={period}
            season={season}
            touchMovement={touchMovement}
            interactionRequest={interactionRequest}
            onInteractionChange={setInteraction}
            onDialogue={handleDialogueChange}
            onPetSound={(sound) =>
              void bgm[sound]().then((played) => !played && showToast(copy.app.petAudioError(petName)))
            }
            onSkid={(sound, intensity, length) => void bgm.skid(sound, intensity, length)}
            onFootstep={(step) =>
              bgm.footstep(getGroundSurface(step, getTownRoads(town.objects), getTownPlaza(town.objects)), step.running)
            }
            guideStep={guideStep}
            onGuideEvent={handleGuideEvent}
            language={language}
            onGuestbookOpen={() => {
              setDialogue(null)
              setGuestbookOpen(true)
            }}
            onHouseUnavailable={showHouseUnavailable}
            onFovChange={changeFov}
            photoRequest={photoRequest}
            onPhotoCapture={finishPhotoCapture}
            onReady={markSceneReady}
            onLoadProgress={updateSceneProgress}
            editing={editedTown !== null}
            editorScene={
              editedTown && (
                <TownEditorScene
                  town={editedTown}
                  selection={editor.selection}
                  view={editorView}
                  category={editorCategory}
                  selecting={editorSelecting}
                  viewCenter={editorViewCenter}
                  focusTargetRef={editorFocusRef}
                  onSelect={editor.select}
                  onGestureStart={editor.beginGesture}
                  onEdit={(change) => editor.edit(change, false)}
                />
              )
            }
          />
        </Suspense>
      </div>
      {!loadingVisible && adminMode && (
        <Suspense fallback={null}>
          {editedTown ? (
            <TownEditorPanel
              language={language}
              editor={editor}
              town={editedTown}
              view={editorView}
              viewCenter={editorViewCenter}
              category={editorCategory}
              selecting={editorSelecting}
              focusTargetRef={editorFocusRef}
              onViewChange={setEditorView}
              onCategoryChange={setEditorCategory}
              onSelectingChange={setEditorSelecting}
              onSignOut={signOutAdmin}
            />
          ) : (
            <AdminGate
              language={language}
              access={adminAccess.status}
              userName={adminAccess.user?.displayName ?? null}
              editorStatus={editor.status}
              loginFailed={loginFailed}
              onRetry={adminAccess.status === 'error' ? adminAccess.refresh : editor.retry}
              onSignOut={signOutAdmin}
            />
          )}
        </Suspense>
      )}
      {!loadingVisible && !adminMode && entered ? (
        <div className="ui-layer">
          <Hud
            language={language}
            playerName={profile.name}
            onCharacter={() => {
              setHudPanel(null)
              setCreatorOpen(true)
            }}
            townName={town.name}
            ownerName={ownerName}
            contactEmail={town.owner.contactEmail}
            interacted={interacted}
            environmentOpen={hudPanel === 'environment'}
            helpOpen={hudPanel === 'help'}
            mapOpen={hudPanel === 'map'}
            debug={debug}
            soundEnabled={bgm.enabled}
            soundStatus={bgm.status}
            periodLabel={copy.periods[period]}
            seasonLabel={copy.seasons[season]}
            previewingEnvironment={previewingEnvironment}
            onLanguageChange={setLanguage}
            onEnvironment={() => setHudPanel((current) => (current === 'environment' ? null : 'environment'))}
            onHelp={() => setHudPanel((current) => (current === 'help' ? null : 'help'))}
            onMap={() => setHudPanel((current) => (current === 'map' ? null : 'map'))}
            onPhoto={requestPhoto}
            onSound={bgm.toggle}
          />
          {hudPanel === 'environment' && (
            <EnvironmentTuner
              language={language}
              period={periodPreview}
              season={seasonPreview}
              activePeriod={period}
              activeSeason={season}
              onPeriodChange={setPeriodPreview}
              onSeasonChange={setSeasonPreview}
              onReset={() => {
                setPeriodPreview('local')
                setSeasonPreview('local')
              }}
              onClose={() => setHudPanel(null)}
            />
          )}
          {hudPanel === 'help' && (
            <HelpPanel
              language={language}
              petName={petName}
              ambientMotion={ambientMotion}
              onAmbientMotion={setAmbientMotion}
              onClose={() => setHudPanel(null)}
            />
          )}
          {hudPanel === 'map' && (
            <TownMapPanel
              language={language}
              town={town}
              playerPosition={playerPosition}
              onClose={() => setHudPanel(null)}
            />
          )}
          {guestbookOpen && (
            <Suspense
              fallback={
                <div className="creator-loading guestbook-loading" role="status">
                  <span className="loader" />
                  <p>{copy.guestbook.opening}</p>
                </div>
              }
            >
              <GuestbookBoard language={language} currentProfile={profile} onClose={closeGuestbook} />
            </Suspense>
          )}
          <InteractionPrompt
            interaction={interaction}
            greetLabel={copy.pet.greetAction(petName)}
            onInteract={() => requestInteraction('interact')}
            onGreet={() => requestInteraction('greet')}
          />
          <Dialogue
            message={dialogue}
            revealTimes={dialogueReveal.revealTimes}
            closeLabel={copy.residentDialogue.close}
            onChoice={askResidentQuestion}
            onClose={() => handleDialogueChange(null)}
          />
          <VirtualStick movementRef={touchMovement} language={language} />
          <Toast message={toast} />
        </div>
      ) : !loadingVisible && !adminMode && !creatorOpen ? (
        guestEntry
      ) : null}
      {creatorOpen && (
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
            profile={profile}
            firstEntry={!entered}
            onApply={applyProfile}
            onCancel={() => setCreatorOpen(false)}
            onActivateAudio={() => {
              if (!entered) bgm.startAfterEntry()
            }}
          />
        </Suspense>
      )}
    </main>
  )
}
