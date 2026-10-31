import { useCallback, useEffect, useState } from 'react'
import { CAMERA_DEFAULTS } from '../camera/cameraConfig'
import type { DemoRepository } from '../data/DemoRepository'
import type { CameraSettings } from '../camera/cameraConfig'
import type { DemoSession, TownGuideStep, TownSnapshot, Vec3 } from '../data/models'
import { normalizePlayerProfile, type PlayerProfile } from '../data/playerProfile'

export function createSeedSession(town: TownSnapshot): DemoSession {
  return {
    townId: town.id,
    playerPosition: structuredClone(town.spawn),
    camera: { ...CAMERA_DEFAULTS },
    profile: normalizePlayerProfile(undefined),
    ui: { instructionsDismissed: false },
  }
}

/** The session of a visitor who has entered the town, saved whenever their character or guide progress changes. */
export function createVisitorSession(
  townId: string,
  position: Vec3,
  camera: CameraSettings,
  profile: PlayerProfile,
  guideStep: TownGuideStep,
): DemoSession {
  return {
    townId,
    playerPosition: { x: position.x, y: position.y, z: position.z },
    camera: { ...camera },
    profile,
    ui: { instructionsDismissed: true, guideStep },
  }
}

export async function resetDemoSession(repository: DemoRepository, town: TownSnapshot) {
  await repository.resetSession(town.id)
  return createSeedSession(town)
}

/** Loads the town and the visitor's session; after a failure, `retry` loads both again. */
export function useDemoSession(repository: DemoRepository, townId: string) {
  const [attempt, setAttempt] = useState(0)
  const [town, setTown] = useState<TownSnapshot | null>(null)
  const [session, setSession] = useState<DemoSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([repository.getTown(townId), repository.getSession(townId)])
      .then(([loadedTown, saved]) => {
        if (!active) return
        setTown(loadedTown)
        setSession(saved ? { ...saved, profile: normalizePlayerProfile(saved.profile) } : createSeedSession(loadedTown))
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the town')
      })
    return () => {
      active = false
    }
  }, [attempt, repository, townId])

  const retry = useCallback(() => {
    setError(null)
    setAttempt((current) => current + 1)
  }, [])

  const save = useCallback(
    async (next: DemoSession) => {
      await repository.saveSession(next)
      setSession(next)
    },
    [repository],
  )

  const reset = useCallback(async () => {
    if (!town) return null
    const next = await resetDemoSession(repository, town)
    setSession(next)
    return next
  }, [repository, town])

  return { town, session, error, save, reset, retry }
}
