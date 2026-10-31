// The only baseball module in the main chunk: everything else under baseball/ loads lazily once this path matches.

/** Mirrors the `/baseball` location in docker/nginx.conf, which gives this page its own CSP and camera permission. */
export const BASEBALL_PATH = '/baseball'

/** Whether the page is the home run derby; a trailing slash matches too, as for `/admin`. */
export function isBaseballPath(pathname: string) {
  return pathname.replace(/\/+$/u, '') === BASEBALL_PATH
}

/** The derby under the rules scheduled for next month, for the admin to try; such a run is never ranked. */
export const NEXT_RULES_PREVIEW_PATH = `${BASEBALL_PATH}?rules=next`

/** Whether the page's query asks for the rules scheduled for next month instead of this month's. */
export function isNextRulesPreview(search: string) {
  return new URLSearchParams(search).get('rules') === 'next'
}
