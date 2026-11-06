import type { TownSnapshot } from '../data/models'
import type { AppLanguage } from '../i18n/language'

/** Mirrors the `/privacy` location in docker/nginx.conf, which gives this page its own strict policy. */
export const PRIVACY_PATH = '/privacy'

/** Served as plain text by its own location in docker/nginx.conf. */
export const ASSET_CREDITS_PATH = '/assets/CREDITS.md'

/** Whether the page is the privacy notice; a trailing slash matches too, as for `/admin`. */
export function isPrivacyPath(pathname: string) {
  return pathname.replace(/\/+$/u, '') === PRIVACY_PATH
}

/** Links open a new tab, which has no memory of the language the visitor chose, so the address carries it. */
export function privacyHref(language: AppLanguage) {
  return `${PRIVACY_PATH}?lang=${language}`
}

/** The language `privacyHref` carried, or null for an address without a language this build knows. */
export function linkedLanguage(search: string): AppLanguage | null {
  const language = new URLSearchParams(search).get('lang')
  return language === 'en' || language === 'ko' ? language : null
}

/**
 * What the notice says about this town, from a town that may not have been read (`null`). The derby is told of only
 * while the town is known to show the ballpark, so a hidden game or a failed read says nothing about it.
 */
export function privacyFacts(town: TownSnapshot | null, language: AppLanguage) {
  return {
    operatorName: town?.owner.name[language].trim() || null,
    contactEmail: town?.owner.contactEmail?.trim() || null,
    tellsOfBallpark: town?.venues.ballpark.visible === true,
  }
}
