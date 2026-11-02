// In the main chunk with the gate (BaseballGate.tsx, useBallparkGate.ts): everything else under baseball/ loads lazily
// once the gate opens the derby.
import type { SessionUser } from '../data/adminSession'
import type { BallparkSettings } from '../data/models'

/** Mirrors the `/baseball` location in docker/nginx.conf, which gives this page its own CSP and camera permission. */
export const BASEBALL_PATH = '/baseball'

/** Whether the page is the home run derby; a trailing slash matches too, as for `/admin`. */
export function isBaseballPath(pathname: string) {
  return pathname.replace(/\/+$/u, '') === BASEBALL_PATH
}

/** The derby under the rules scheduled for next month, for the admin to try; such a run is never ranked. */
export const NEXT_RULES_PREVIEW_PATH = `${BASEBALL_PATH}?rules=next`

/** The derby under this month's rules, for the admin to try while the ballpark is hidden; never ranked either. */
export const CURRENT_RULES_PREVIEW_PATH = `${BASEBALL_PATH}?rules=current`

/** An admin's preview, by whose rules it plays: next month's or this month's. */
export type BaseballPreview = 'next' | 'current'

/** The preview the page's query asks for (`rules=next` or `rules=current`), or null for a visitor's game. */
export function baseballPreview(search: string): BaseballPreview | null {
  const rules = new URLSearchParams(search).get('rules')
  return rules === 'next' || rules === 'current' ? rules : null
}

/** Where the page's back links and Escape lead, by `baseballExit`. */
export const EXIT_PATHS = { town: '/', editor: '/admin' } as const

export type BaseballExit = keyof typeof EXIT_PATHS

/** The editor opens its preview in the same tab, so a preview leaves for the editor and any other run for the town. */
export function baseballExit(preview: boolean): BaseballExit {
  return preview ? 'editor' : 'town'
}

/**
 * Whether this page plays the derby: always while the admin shows the ballpark. While it is hidden only the admin's
 * preview does, so only then is `sessionUser` asked who is signed in; a failed check keeps the ballpark closed.
 */
export async function ballparkOpens(
  ballpark: Pick<BallparkSettings, 'visible'>,
  preview: boolean,
  sessionUser: () => Promise<SessionUser | null>,
) {
  if (ballpark.visible) return true
  if (!preview) return false
  const user = await sessionUser().catch(() => null)
  return user?.role === 'admin'
}
