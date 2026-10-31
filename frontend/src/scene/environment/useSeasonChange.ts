import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Color } from 'three'
import type { Season } from './season'
import {
  createSeasonChange,
  getWindowProgress,
  isSeasonChangeSettled,
  seasonClock,
  startSeasonChange,
  type SeasonChange,
} from './seasonTransition'

/** The town's season, changed over several seconds instead of at once; read it every frame. */
export function useSeasonChange(season: Season, reducedMotion: boolean) {
  const change = useRef(createSeasonChange(season))
  useLayoutEffect(() => {
    if (change.current.to === season) return
    change.current = startSeasonChange(change.current, season, seasonClock(), reducedMotion)
  }, [reducedMotion, season])
  return change
}

/** Fades one material's color between the seasons' `colors` during `layer` of the change. */
export function useSeasonalColor(
  target: MutableRefObject<{ color: Color } | null>,
  seasonChange: MutableRefObject<SeasonChange>,
  colors: Readonly<Record<Season, string>>,
  layer: 'foliage' | 'ground',
) {
  const fade = useRef<{ startedAt: number; from: Color; to: Color; settled: boolean } | null>(null)
  useFrame(() => {
    const material = target.current
    const change = seasonChange.current
    if (!material || (fade.current?.startedAt === change.startedAt && fade.current.settled)) return
    if (fade.current?.startedAt !== change.startedAt) {
      fade.current = {
        startedAt: change.startedAt,
        from: material.color.clone(),
        to: new Color(colors[change.to]),
        settled: false,
      }
    }
    const now = seasonClock()
    const { from, to } = fade.current
    material.color.lerpColors(from, to, getWindowProgress(change.timeline[layer], now - change.startedAt))
    fade.current.settled = isSeasonChangeSettled(change, now)
  })
}
