import { KeyboardControls, useProgress } from '@react-three/drei'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NeutralToneMapping, Vector3 } from 'three'
import type { MutableRefObject, ReactNode } from 'react'
import type { CameraSettings } from '../camera/cameraConfig'
import type { TownGuideStep, TownSnapshot, Vec3 } from '../data/models'
import type { PlayerProfile } from '../data/playerProfile'
import type { TownGuideEvent } from '../data/townGuide'
import type { AppLanguage } from '../i18n/language'
import { CameraRig } from './CameraRig'
import { DebugHelpers } from './DebugHelpers'
import { Player } from './characters/Player'
import { Town } from './Town'
import { keyboardMap } from './controls'
import type { DialogueMessage, Interaction, InteractionRequest } from './playerInteraction'
import { getPetRoute } from './animals/corgiGait'
import type { PetSound } from './animals/petInteraction'
import type { SkidSound, SquealLength } from '../audio/skidSqueal'
import type { AmbientScene } from '../audio/ambience'
import { getGroundSurface, getTownPlaza, type Footstep } from './environment/groundSurface'
import { getTownRoads } from './objects/roads/roadLayout'
import { getSnowCover, seasonClock } from './environment/seasonTransition'
import { Residents } from './characters/Residents'
import { createTownCollision } from './townCollision'
import { createResidentSpecs, createWorldActors, type RoundObstacle } from './motion/npcMotion'
import { getBenchSeats } from './motion/characterPose'
import { Atmosphere } from './environment/Atmosphere'
import { AmbientSound } from './environment/AmbientSound'
import { dayPeriods, type DayPeriod } from './environment/dayCycle'
import { GraphicsCanvas } from './GraphicsCanvas'
import { ScenePhotoCapture } from './ScenePhotoCapture'
import type { Season } from './environment/season'
import { FOUNTAIN_RADIUS } from './objects/fountain/fountainLayout'
import { useSeasonChange } from './environment/useSeasonChange'
import { useDayChange, useLampsOn } from './environment/useDayChange'
import { SkyLight, SunLight } from './environment/SunLight'
import { TownGuideMarker } from './TownGuideMarker'
import { groupTownObjects } from './townObjectGroups'
import type { TownLayerProps } from './objects/townObjectKind'
import { installWorldCurve } from './worldCurve'

// Before any town material compiles; the editor's scene renders inside this one, so `/admin` bends too.
installWorldCurve()

type Props = {
  profile: PlayerProfile
  controlsEnabled: boolean
  town: TownSnapshot
  spawn: Vec3
  settings: CameraSettings
  debug: boolean
  playerResetKey: number
  cameraResetKey: number
  playerPosition: MutableRefObject<Vector3>
  reducedMotion: boolean
  ambientMotion: boolean
  period: DayPeriod
  season: Season
  touchMovement: MutableRefObject<{ x: number; y: number }>
  interactionRequest: InteractionRequest
  onInteractionChange: (interaction: Interaction | null) => void
  onDialogue: (message: DialogueMessage | null) => void
  onPetSound: (sound: PetSound) => void
  onSkid: (sound: SkidSound, intensity: number, length: SquealLength) => void
  onFootstep: (step: Footstep) => void
  /** Feeds the ambient sound a few times a second; without it the town has none. */
  onAmbience?: (scene: AmbientScene | null) => void
  guideStep: TownGuideStep
  onGuideEvent: (event: TownGuideEvent) => void
  language: AppLanguage
  onGuestbookOpen: () => void
  onHouseUnavailable: () => void
  onFovChange: (fov: number) => void
  photoRequest: number
  onPhotoCapture: (saved: boolean) => void
  onReady: () => void
  onLoadProgress: (progress: number) => void
  /** Admin editing: `editorScene` replaces the follow camera. */
  editing?: boolean
  editorScene?: ReactNode
}

export function SceneReady({ onReady }: { onReady: () => void }) {
  useEffect(() => onReady(), [onReady])
  return null
}

export function SceneProgress({ onProgress }: { onProgress: (progress: number) => void }) {
  const { progress } = useProgress()
  useEffect(() => onProgress(progress), [onProgress, progress])
  return null
}

export function TownScene({
  profile,
  controlsEnabled,
  town,
  spawn,
  settings,
  debug,
  playerResetKey,
  cameraResetKey,
  playerPosition,
  reducedMotion,
  ambientMotion,
  period,
  season,
  touchMovement,
  interactionRequest,
  onInteractionChange,
  onDialogue,
  onPetSound,
  onSkid,
  onFootstep,
  onAmbience,
  guideStep,
  onGuideEvent,
  language,
  onGuestbookOpen,
  onHouseUnavailable,
  onFovChange,
  photoRequest,
  onPhotoCapture,
  onReady,
  onLoadProgress,
  editing = false,
  editorScene,
}: Props) {
  const movementDirection = useRef(new Vector3())
  const dampedTarget = useRef(new Vector3())
  const lookAheadTarget = useRef(new Vector3())
  const residentSpecs = useMemo(() => createResidentSpecs(town.residents), [town.residents])
  const actors = useMemo(() => ({ current: createWorldActors(residentSpecs) }), [residentSpecs])
  const seats = useMemo(() => getBenchSeats(town.objects), [town.objects])
  const collision = useMemo(() => createTownCollision(town.objects), [town.objects])
  const groups = useMemo(() => groupTownObjects(town.objects), [town.objects])
  const fountain = groups.fountain
  const obstacles = useMemo<RoundObstacle[]>(
    () =>
      fountain ? [{ x: fountain.position.x, z: fountain.position.z, radius: FOUNTAIN_RADIUS * fountain.scale }] : [],
    [fountain],
  )
  const occupiedSeat = useRef<string | null>(null)
  // The fog and background start in the opening period's colors; Atmosphere fades them after that.
  const [openingLight] = useState(() => dayPeriods[period])
  const dayChange = useDayChange(period, reducedMotion)
  const lampsOn = useLampsOn(dayPeriods[period].lamps, reducedMotion)
  const seasonChange = useSeasonChange(season, reducedMotion)
  const dialogueFocus = useRef<Vector3 | null>(null)
  const roads = useMemo(() => getTownRoads(groups.roads), [groups.roads])
  const plaza = useMemo(() => getTownPlaza(town.objects), [town.objects])
  const surfaceAt = (x: number, z: number) =>
    getGroundSurface({ x, z, running: false, snow: getSnowCover(seasonChange.current, seasonClock()) }, roads, plaza)
  const footstep = (x: number, z: number, running: boolean) =>
    onFootstep({ x, z, running, snow: getSnowCover(seasonChange.current, seasonClock()) })
  const petName = town.pet.name[language]
  const ownerName = town.owner.name[language]
  const petRoute = useMemo(() => getPetRoute(town.pet, fountain?.position), [fountain, town.pet])
  const layerProps = useMemo<TownLayerProps>(
    () => ({
      seasonChange,
      dayChange,
      period,
      lampsOn,
      reducedMotion,
      motionEnabled: ambientMotion,
      editing,
      playerPosition,
      actors,
      language,
      petName,
    }),
    [
      actors,
      ambientMotion,
      dayChange,
      editing,
      lampsOn,
      language,
      period,
      petName,
      playerPosition,
      reducedMotion,
      seasonChange,
    ],
  )
  const reportGlance = useCallback(() => onGuideEvent('glanced'), [onGuideEvent])
  const reportViewAdjusted = useCallback(() => onGuideEvent('adjusted-view'), [onGuideEvent])

  return (
    <KeyboardControls map={controlsEnabled ? keyboardMap : []}>
      <GraphicsCanvas
        language={language}
        shadows="percentage"
        camera={{ fov: settings.fov, near: 0.1, far: 300 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: NeutralToneMapping }}
        aria-label={`Interactive 3D view of ${town.name}`}
        onUnavailable={onReady}
      >
        <SceneProgress onProgress={onLoadProgress} />
        <color attach="background" args={[openingLight.sky]} />
        <fog attach="fog" args={[openingLight.fog, 68, 145]} />
        <Atmosphere
          dayChange={dayChange}
          seasonChange={seasonChange}
          reducedMotion={reducedMotion}
          motionEnabled={ambientMotion}
          treeObjects={groups.trees}
          editing={editing}
        />
        <SkyLight dayChange={dayChange} seasonChange={seasonChange} />
        <SunLight dayChange={dayChange} playerPosition={playerPosition} editing={editing} />
        <Suspense fallback={null}>
          <Town town={town} scene={layerProps} />
          <Residents
            residentSpecs={residentSpecs}
            actors={actors}
            seats={seats}
            occupiedSeat={occupiedSeat}
            playerPosition={playerPosition}
            reducedMotion={reducedMotion}
            obstacles={obstacles}
            gaitStyle={town.movement.gait}
            language={language}
            petName={petName}
            petRoute={petRoute}
            ownerName={ownerName}
            ownerResidentId={town.owner.residentId}
          />
          <TownGuideMarker step={guideStep} town={town} actors={actors} playerPosition={playerPosition} />
          <Player
            profile={profile}
            controlsEnabled={controlsEnabled}
            spawn={spawn}
            resetKey={playerResetKey}
            playerPosition={playerPosition}
            movementDirection={movementDirection}
            touchMovement={touchMovement}
            actors={actors}
            collision={collision}
            seats={seats}
            houses={groups.houses}
            guestbookPosition={groups.guestbook?.position ?? null}
            occupiedSeatRef={occupiedSeat}
            interactionRequest={interactionRequest}
            onInteractionChange={onInteractionChange}
            onDialogue={onDialogue}
            onPetSound={onPetSound}
            onSkid={onSkid}
            skidStyle={town.movement.skid}
            gaitStyle={town.movement.gait}
            onFootstep={footstep}
            surfaceAt={surfaceAt}
            dialogueFocusRef={dialogueFocus}
            onGuideEvent={onGuideEvent}
            guideStep={guideStep}
            language={language}
            ownerName={ownerName}
            petName={petName}
            ownerResidentId={town.owner.residentId}
            onGuestbookOpen={onGuestbookOpen}
            onHouseUnavailable={onHouseUnavailable}
            reducedMotion={reducedMotion}
          />
          {onAmbience && (
            <AmbientSound
              fountain={fountain}
              playerPosition={playerPosition}
              seasonChange={seasonChange}
              period={period}
              season={season}
              onAmbience={onAmbience}
            />
          )}
          <SceneReady onReady={onReady} />
        </Suspense>
        {editing ? (
          <Suspense fallback={null}>{editorScene}</Suspense>
        ) : (
          <CameraRig
            settings={settings}
            playerPosition={playerPosition}
            movementDirection={movementDirection}
            dampedTarget={dampedTarget}
            lookAheadTarget={lookAheadTarget}
            resetKey={cameraResetKey}
            reducedMotion={reducedMotion}
            onFovChange={onFovChange}
            onGlance={reportGlance}
            onViewAdjusted={reportViewAdjusted}
            dialogueFocusRef={dialogueFocus}
          />
        )}
        <ScenePhotoCapture request={photoRequest} onComplete={onPhotoCapture} />
        {debug && (
          <DebugHelpers playerPosition={playerPosition} dampedTarget={dampedTarget} lookAheadTarget={lookAheadTarget} />
        )}
      </GraphicsCanvas>
    </KeyboardControls>
  )
}
