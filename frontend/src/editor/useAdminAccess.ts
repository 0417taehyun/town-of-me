import { useEffect, useState } from 'react'
import { getSessionUser, type SessionUser } from '../data/adminSession'

export type AdminAccessStatus = 'disabled' | 'checking' | 'signed-out' | 'not-admin' | 'admin' | 'error'

/** The admin editor lives at /admin; LinkedIn sign-in is only used there. */
export function isAdminPath(pathname: string) {
  return pathname.replace(/\/+$/u, '') === '/admin'
}

type SessionCheck = { attempt: number; user: SessionUser | null; failed: boolean }

export function getAdminAccessStatus(enabled: boolean, attempt: number, check: SessionCheck | null): AdminAccessStatus {
  if (!enabled) return 'disabled'
  if (check?.attempt !== attempt) return 'checking'
  if (check.failed) return 'error'
  if (!check.user) return 'signed-out'
  return check.user.role === 'admin' ? 'admin' : 'not-admin'
}

/** Which admin screen to show; the backend still checks the admin role on every save. */
export function useAdminAccess(enabled: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [check, setCheck] = useState<SessionCheck | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void getSessionUser().then(
      (user) => active && setCheck({ attempt, user, failed: false }),
      () => active && setCheck({ attempt, user: null, failed: true }),
    )
    return () => {
      active = false
    }
  }, [attempt, enabled])

  return {
    status: getAdminAccessStatus(enabled, attempt, check),
    user: check?.attempt === attempt ? check.user : null,
    refresh: () => setAttempt((value) => value + 1),
  }
}
