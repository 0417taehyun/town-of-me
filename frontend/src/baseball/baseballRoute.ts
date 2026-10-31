// The only baseball module in the main chunk: everything else under baseball/ loads lazily once this path matches.

/** Mirrors the `/baseball` location in docker/nginx.conf, which gives this page its own CSP and camera permission. */
export const BASEBALL_PATH = '/baseball'

/** Whether the page is the home run derby; a trailing slash matches too, as for `/admin`. */
export function isBaseballPath(pathname: string) {
  return pathname.replace(/\/+$/u, '') === BASEBALL_PATH
}
