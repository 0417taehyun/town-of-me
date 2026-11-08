/**
 * What a link to the town shows in chat apps and social feeds, whose crawlers read only the page's head and run no
 * script. Each deployment may name its own town at build time; the picture is the sample town's, the same for all.
 */
export type SharePreviewSettings = { origin?: string; title?: string; description?: string }

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

export function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * The page title and preview tags for `settings`, a blank setting falling back to the default. Most crawlers ignore a
 * relative image address, so a deployment sets `origin`; without one, as in development, the address stays relative.
 */
export function sharePreviewTags(settings: SharePreviewSettings) {
  const title = settings.title?.trim() || DEFAULT_SHARE_TEXT.title
  const description = settings.description?.trim() || DEFAULT_SHARE_TEXT.description
  const origin = settings.origin?.trim().replace(/\/+$/u, '') ?? ''
  const tags = [
    ['name', 'description', description],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', DEFAULT_SHARE_TEXT.title],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', `${origin}/`],
    ['property', 'og:image', `${origin}${SHARE_IMAGE.path}`],
    ['property', 'og:image:width', String(SHARE_IMAGE.width)],
    ['property', 'og:image:height', String(SHARE_IMAGE.height)],
    ['property', 'og:image:alt', SHARE_IMAGE.alt],
    ['name', 'twitter:card', 'summary_large_image'],
  ]
  return [
    `<title>${escapeHtml(title)}</title>`,
    ...tags.map(([attribute, name, content]) => `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`),
  ].join('\n    ')
}
