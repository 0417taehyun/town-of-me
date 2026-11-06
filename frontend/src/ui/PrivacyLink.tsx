import { type AppLanguage, languageCopy } from '../i18n/language'
import { privacyHref } from './privacyNotice'

/** Opens the notice in a new tab, so reading it leaves the town or the game as it was. */
export function PrivacyLink({ language }: { language: AppLanguage }) {
  const copy = languageCopy[language].privacy
  return (
    <a
      className="privacy-link"
      href={privacyHref(language)}
      target="_blank"
      rel="noopener"
      aria-label={copy.linkDescription}
    >
      {copy.title}
    </a>
  )
}
