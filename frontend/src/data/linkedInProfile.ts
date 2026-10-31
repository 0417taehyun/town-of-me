export function isLinkedInHttpsUrl(url: URL) {
  return url.protocol === 'https:' && (url.hostname === 'linkedin.com' || url.hostname === 'www.linkedin.com')
}

export function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** The canonical public profile address, or `null` for anything that is not a plain LinkedIn profile link. */
export function linkedInProfileUrlFrom(url: URL) {
  if (!isLinkedInHttpsUrl(url) || url.username || url.password) return null
  const profileId = url.pathname.match(/^\/in\/([A-Za-z0-9_%-]{1,100})(?:\/|$)/u)?.[1]
  return profileId ? `https://www.linkedin.com/in/${profileId}` : null
}

export function normalizeLinkedInProfileUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const url = parseUrl(value.trim())
  return url && linkedInProfileUrlFrom(url)
}

export function linkedInProfileUrlError(value: string) {
  if (!value.trim()) return null
  return normalizeLinkedInProfileUrl(value) ? null : 'Enter a valid LinkedIn profile URL.'
}
