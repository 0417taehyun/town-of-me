import { useCallback, useEffect, useState } from 'react'
import { CAMERA_DEFAULTS } from '../camera/cameraConfig'
import type { CameraSettings } from '../camera/cameraConfig'
import type { TownGuideStep, TownSnapshot, Vec3, VisitorSession } from '../data/models'
import { normalizePlayerProfile, type PlayerProfile } from '../data/playerProfile'
import { getBrowserSessionStore, readStoredSession, saveStoredSession } from '../data/visitorSession'

export function createSeedSession(town: TownSnapshot): VisitorSession {
  return {
    playerPosition: structuredClone(town.spawn),
    camera: { ...CAMERA_DEFAULTS },
    profile: normalizePlayerProfile(undefined),
    ui: { instructionsDismissed: false },
  }
}

/** The session of a visitor who has entered the town, saved whenever their character or guide progress changes. */
export function createVisitorSession(
  position: Vec3,
  camera: CameraSettings,
  profile: PlayerProfile,
  guideStep: TownGuideStep,
): VisitorSession {
  return {
    playerPosition: { x: position.x, y: position.y, z: position.z },
    camera: { ...camera },
    profile,
    ui: { instructionsDismissed: true, guideStep },
  }
}

/** Loads the town and the visitor's session; after a failure, `retry` loads both again. */
export function useVisitorSession(loadTown: () => Promise<TownSnapshot>) {
  const [attempt, setAttempt] = useState(0)
  const [town, setTown] = useState<TownSnapshot | null>(null)
  const [session, setSession] = useState<VisitorSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadTown()
      .then((loadedTown) => {
        if (!active) return
        setTown(loadedTown)
        setSession(readStoredSession(getBrowserSessionStore()) ?? createSeedSession(loadedTown))
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the town')
      })
    return () => {
      active = false
    }
  }, [attempt, loadTown])

  const retry = useCallback(() => {
    setError(null)
    setAttempt((current) => current + 1)
  }, [])

  const save = useCallback(async (next: VisitorSession) => {
    saveStoredSession(getBrowserSessionStore(), next)
    setSession(next)
  }, [])

  return { town, session, error, save, retry }
}
