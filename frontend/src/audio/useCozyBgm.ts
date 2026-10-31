import { useCallback, useEffect, useRef, useState } from 'react'
import type { DayPeriod } from '../scene/environment/dayCycle'
import type { GroundSurface } from '../scene/environment/groundSurface'
import { createCozyMusic, type MusicStatus } from './cozyMusic'
import type { SkidSound, SquealLength } from './skidSqueal'
import type { AmbientScene } from './ambience'
import { createBark } from './bark'

const MUSIC_VOLUME = 2
const PET_VOLUME = 4.5
const RESIDENT_VOLUME = 6

export function useCozyBgm(period: DayPeriod) {
  const engineRef = useRef<ReturnType<typeof createCozyMusic> | null>(null)
  const barkRef = useRef<ReturnType<typeof createBark> | null>(null)
  const periodRef = useRef(period)
  const wantedRef = useRef(true)
  const [status, setStatus] = useState<MusicStatus>('blocked')

  useEffect(() => {
    periodRef.current = period
    engineRef.current?.setPeriod(period)
  }, [period])

  const getEngine = useCallback(() => {
    engineRef.current ??= createCozyMusic(periodRef.current, setStatus)
    engineRef.current.setVolume(MUSIC_VOLUME)
    engineRef.current.setPetVolume(PET_VOLUME)
    engineRef.current.setResidentVolume(RESIDENT_VOLUME)
    return engineRef.current
  }, [])

  const start = useCallback(() => {
    wantedRef.current = true
    try {
      void getEngine().start()
    } catch {
      setStatus('unavailable')
    }
  }, [getEngine])

  useEffect(() => {
    const retryPointer = (event: PointerEvent) => {
      if (event.button !== 0 || !wantedRef.current) return
      if (event.target instanceof Element && event.target.closest('[data-music-control]')) return
      start()
    }
    const retryKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || !wantedRef.current) return
      if (['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(event.key)) return
      if (event.target instanceof Element && event.target.closest('[data-music-control]')) return
      start()
    }
    document.addEventListener('pointerdown', retryPointer)
    document.addEventListener('keydown', retryKey)
    // StrictMode can cancel its first mount before the automatic attempt creates audio.
    const autoplay = window.setTimeout(() => wantedRef.current && start(), 0)
    return () => {
      window.clearTimeout(autoplay)
      document.removeEventListener('pointerdown', retryPointer)
      document.removeEventListener('keydown', retryKey)
      engineRef.current?.dispose()
      // StrictMode replays setup after cleanup; never resume the old closed context.
      engineRef.current = null
      barkRef.current?.dispose()
      barkRef.current = null
    }
  }, [start])

  const bark = useCallback(() => {
    engineRef.current?.stopPant()
    barkRef.current ??= createBark(`${import.meta.env.BASE_URL}assets/audio/corgi-bark.mp3`)
    barkRef.current.setVolume(PET_VOLUME)
    return barkRef.current.play()
  }, [])

  const pant = useCallback(() => {
    barkRef.current?.stop()
    try {
      return getEngine().pant()
    } catch {
      return Promise.resolve(false)
    }
  }, [getEngine])

  const skid = useCallback(
    (kind: SkidSound, intensity: number, length: SquealLength) => {
      try {
        return getEngine().skid(kind, intensity, length)
      } catch {
        return Promise.resolve(false)
      }
    },
    [getEngine],
  )

  const footstep = useCallback(
    (surface: GroundSurface, running: boolean) => {
      try {
        return getEngine().footstep(surface, running)
      } catch {
        return false
      }
    },
    [getEngine],
  )

  const speak = useCallback(
    (text: string, speaker: string) => {
      try {
        return getEngine().speak(text, speaker)
      } catch {
        return Promise.resolve(false)
      }
    },
    [getEngine],
  )

  const stopSpeaking = useCallback(() => engineRef.current?.stopSpeaking(), [])

  // Never creates the engine: ambient sound waits for the music's own start, and its browser permission.
  const setAmbience = useCallback((scene: AmbientScene | null) => engineRef.current?.setAmbience(scene), [])

  const toggle = useCallback(() => {
    if (status !== 'playing') {
      start()
      return
    }
    wantedRef.current = false
    engineRef.current?.pause()
  }, [start, status])

  return {
    enabled: status === 'playing',
    status,
    startAfterEntry: start,
    toggle,
    bark,
    pant,
    skid,
    footstep,
    speak,
    stopSpeaking,
    setAmbience,
  }
}
