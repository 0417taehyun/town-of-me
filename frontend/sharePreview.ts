/**
 * What a link to the town shows in chat apps and social feeds, whose crawlers read only the page's head and run no
 * script. Each deployment may name its own town at build time; the picture is the sample town's, the same for all.
 */
export type SharePreviewSettings = { origin?: string; title?: string; description?: string }

/** A page with its own preview: its address under the origin, its picture, and the words a blank setting falls back to. */
export type SharePreviewPage = {
  path: string
  image: { path: string; width: number; height: number; alt: string }
  title: string
  description: string
}

export const SHARE_IMAGE = {
  path: '/og-image.jpg',
  width: 1200,
  height: 630,
  alt: 'A cozy 3D town with a fountain, houses, and autumn trees, where residents walk about',
}

export const DEFAULT_SHARE_TEXT = {
  title: 'Town of Me',
  description: 'A portfolio you can walk through: a small 3D town with residents, a guestbook, and a corgi.',
}

export const TOWN_SHARE_PAGE: SharePreviewPage = { path: '/', image: SHARE_IMAGE, ...DEFAULT_SHARE_TEXT }

/** The home run derby's preview. Its words are fixed: a deployment's title and description name its town only. */
export const DERBY_SHARE_PAGE: SharePreviewPage = {
  path: '/baseball',
  image: {
    path: '/og-baseball.jpg',
    width: 1200,
    height: 630,
    alt: 'A batter in a red cap swings at a pitch in a small 3D ballpark with a full stand and autumn trees',
  },
  title: 'Home Run Derby · Town of Me',
  description: 'Swing at your webcam and send the pitches over the fence. Your camera never leaves your device.',
}

export function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * The page title and preview tags for `settings`, a blank setting falling back to the default. Most crawlers ignore a
 * relative image address, so a deployment sets `origin`; without one, as in development, the address stays relative.
 */
export function sharePreviewTags(settings: SharePreviewSettings, page: SharePreviewPage = TOWN_SHARE_PAGE) {
  const title = settings.title?.trim() || page.title
  const description = settings.description?.trim() || page.description
  const origin = settings.origin?.trim().replace(/\/+$/u, '') ?? ''
  const tags = [
    ['name', 'description', description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', DEFAULT_SHARE_TEXT.title],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', `${origin}${page.path}`],
    ['property', 'og:image', `${origin}${page.image.path}`],
    ['property', 'og:image:width', String(page.image.width)],
    ['property', 'og:image:height', String(page.image.height)],
    ['property', 'og:image:alt', page.image.alt],
    ['name', 'twitter:card', 'summary_large_image'],
  ]
  return [
    `<title>${escapeHtml(title)}</title>`,
    ...tags.map(([attribute, name, content]) => `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`),
  ].join('\n    ')
}
