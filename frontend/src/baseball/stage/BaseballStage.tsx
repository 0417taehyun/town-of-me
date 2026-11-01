import { useMemo, useRef, useState, type MutableRefObject } from 'react'
import { NeutralToneMapping, Vector3 } from 'three'
import type { TownObject } from '../../data/models'
import type { PlayerProfile } from '../../data/playerProfile'
import type { AppLanguage } from '../../i18n/language'
import { Atmosphere } from '../../scene/environment/Atmosphere'
import { dayPeriods, type DayPeriod } from '../../scene/environment/dayCycle'
import type { Season } from '../../scene/environment/season'
import { SkyLight, SunLight } from '../../scene/environment/SunLight'
import { useDayChange, useLampsOn } from '../../scene/environment/useDayChange'
import { useSeasonChange } from '../../scene/environment/useSeasonChange'
import { GraphicsCanvas } from '../../scene/GraphicsCanvas'
import type { BallparkPalette } from '../../scene/venues/ballpark/ballparkThemes'
import { useVenueMaterials } from '../../scene/venues/venueMaterials'
import type { BattingSide } from '../game/field'
import { crowdCheer } from '../stadium/crowdLayout'
import { Crowd } from '../stadium/Crowd'
import { Dugouts } from '../stadium/Dugouts'
import { Floodlight } from '../stadium/Floodlight'
import { GardenBowl } from '../stadium/GardenBowl'
import { GardenBreeze } from '../stadium/GardenBreeze'
import { GardenLandmarks } from '../stadium/GardenLandmarks'
import { useApprovedLooks } from '../stadium/guestLooks'
import { StadiumField } from '../stadium/StadiumField'
import { type DerbyHudState, judgedResult } from '../ui/derbyCues'
import type { BallView } from './ballMeshes'
import type { FreeBand } from './cameraShots'
import { DerbyDirector } from './DerbyDirector'
import type { RealTimeSwing, RealTimeSwingCue, StageEvent, StageRunSetup } from './stageRun'

/**
 * Petals and leaves fall from the town's trees, and its fireflies gather round the camera; the garden's breeze
 * (GardenBreeze.tsx) drifts its own petals and fireflies clear of the pitch, so only winter's snow falls here.
 */
const NO_TREES: TownObject[] = []
/** The fog begins past the outfield hedge, so the whole field stays clear. */
const STADIUM_FOG = { near: 130, far: 380 }

/**
 * The derby's stadium on its own flat canvas (the town's world curve is never installed here). The sky, the light, and
 * the nature follow the visitor's time of day and season like the town's, and the ballpark's lamps light with the
 * town's; they only change how it looks. The play is
 * centred in `band`, the part of the screen the camera panel leaves free, and stands still while `paused`. When the
 * graphics fail or are lost, `onUnavailable` lets the page say why in the visitor's language. A computer on the
 * `reducedTier` (vision/performanceTier.ts) draws fewer people and petals around the play, and reduced motion leaves
 * the garden's breeze out.
 */
export function BaseballStage({
  language,
  label,
  profile,
  palette,
  side,
  run,
  swings,
  swingCues,
  onEvent,
  band,
  paused,
  period,
  season,
  reducedMotion,
  hud,
  pitchCount,
  reducedTier,
  onUnavailable,
}: {
  language: AppLanguage
  label: string
  profile: PlayerProfile
  palette: BallparkPalette
  side: BattingSide
  run: StageRunSetup | null
  swings: MutableRefObject<RealTimeSwing[]>
  swingCues: MutableRefObject<RealTimeSwingCue[]>
  onEvent: (event: StageEvent) => void
  band: FreeBand
  paused: boolean
  period: DayPeriod
  season: Season
  reducedMotion: boolean
  /** The run so far, for the treehouse scoreboard; a new run's before the run starts. */
  hud: DerbyHudState
  pitchCount: number
  reducedTier: boolean
  onUnavailable: () => void
}) {
  const dayChange = useDayChange(period, reducedMotion)
  const seasonChange = useSeasonChange(season, reducedMotion)
  const lampsOn = useLampsOn(dayPeriods[period].lamps, reducedMotion)
  // The fog and background start in the opening period's colors; Atmosphere fades them after that.
  const [openingLight] = useState(() => dayPeriods[period])
  const materials = useVenueMaterials(palette)
  // The sun's shadow frame stays on the plate and the mound, where the players are.
  const shadowFocus = useMemo(() => ({ current: new Vector3(0, 0, -4) }), [])
  const approvedLooks = useApprovedLooks()
  const ballView = useRef<BallView | null>(null)
  const judged = judgedResult(hud)

  return (
    <GraphicsCanvas
      language={language}
      shadows="percentage"
      camera={{ fov: 48, near: 0.3, far: 700 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', toneMapping: NeutralToneMapping }}
      aria-label={label}
      onUnavailable={onUnavailable}
    >
      <color attach="background" args={[openingLight.sky]} />
      <fog attach="fog" args={[openingLight.fog, STADIUM_FOG.near, STADIUM_FOG.far]} />
      <Atmosphere
        dayChange={dayChange}
        seasonChange={seasonChange}
        reducedMotion={reducedMotion}
        motionEnabled
        treeObjects={NO_TREES}
        editing={false}
        fireflies={false}
      />
      <SkyLight dayChange={dayChange} seasonChange={seasonChange} />
      <SunLight dayChange={dayChange} playerPosition={shadowFocus} editing={false} />
      <Floodlight dayChange={dayChange} />
      <StadiumField materials={materials} seasonChange={seasonChange} />
      <Dugouts materials={materials} lampsOn={lampsOn} />
      <GardenLandmarks
        materials={materials}
        seasonChange={seasonChange}
        language={language}
        hud={hud}
        pitchCount={pitchCount}
        lampsOn={lampsOn}
      />
      <GardenBowl
        materials={materials}
        seasonChange={seasonChange}
        dayChange={dayChange}
        reducedMotion={reducedMotion}
        lampsOn={lampsOn}
      />
      <Crowd
        approved={approvedLooks}
        ballViewRef={ballView}
        cheer={crowdCheer(judged)}
        reduced={reducedTier}
        reducedMotion={reducedMotion}
      />
      {!reducedMotion && (
        <GardenBreeze
          seasonChange={seasonChange}
          dayChange={dayChange}
          ballViewRef={ballView}
          homeRun={judged?.outcome === 'homeRun'}
          reduced={reducedTier}
        />
      )}
      <DerbyDirector
        run={run}
        profile={profile}
        side={side}
        swings={swings}
        swingCues={swingCues}
        onEvent={onEvent}
        band={band}
        paused={paused}
        reducedMotion={reducedMotion}
        ballViewRef={ballView}
        approved={approvedLooks}
        reducedTier={reducedTier}
      />
    </GraphicsCanvas>
  )
}
