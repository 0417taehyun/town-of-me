import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Vector3 } from 'three'
import type { AmbientScene } from '../../audio/ambience'
import type { TownObject } from '../../data/models'
import { getFountainFlow } from '../objects/fountain/fountainMotion'
import { getFountainRimDistance } from '../objects/fountain/fountainLayout'
import type { DayPeriod } from './dayCycle'
import type { Season } from './season'
import { getSnowCover, seasonClock, type SeasonChange } from './seasonTransition'

/** The sound eases between reports, so a few a second keep it smooth without touching audio every frame. */
const REPORT_SECONDS = 0.2

/** Tells the town's ambient sound where the player stands and what time and season it is; silences it on leaving. */
export function AmbientSound({
  fountain,
  playerPosition,
  seasonChange,
  period,
  season,
  onAmbience,
}: {
  fountain: TownObject | undefined
  playerPosition: MutableRefObject<Vector3>
  seasonChange: MutableRefObject<SeasonChange>
  period: DayPeriod
  season: Season
  onAmbience: (scene: AmbientScene | null) => void
}) {
  const sinceReport = useRef(REPORT_SECONDS)
  useEffect(() => () => onAmbience(null), [onAmbience])
  useFrame((_, delta) => {
    sinceReport.current += delta
    if (sinceReport.current < REPORT_SECONDS) return
    sinceReport.current = 0
    const player = playerPosition.current
    onAmbience({
      fountainDistance: getFountainRimDistance(fountain, player.x, player.z),
      fountainFlow: getFountainFlow(getSnowCover(seasonChange.current, seasonClock())),
      period,
      season,
    })
  })
  return null
}
