import { recordSiteEvent } from '../data/siteEvents'
import { contactEmailHref } from '../data/townApi'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { LanguageSelect } from './LanguageSelect'

/** A button-styled link to the visitor's mail app; the address only ever reaches the encoded `mailto:` link. */
export function OwnerContactLink({
  language,
  ownerName,
  email,
  className,
}: {
  language: AppLanguage
  /** The town owner's name in `language`. */
  ownerName: string
  email: string
  className: string
}) {
  return (
    <a
      className={`contact-link ${className}`}
      href={contactEmailHref(email)}
      onClick={() => recordSiteEvent('contact-opened')}
    >
      <span aria-hidden="true">✉</span>
      {languageCopy[language].introduction.contact(ownerName)}
    </a>
  )
}

/** The owner's introduction between the entry card and the character creator, in the entry card's style. */
export function OwnerIntroduction({
  language,
  ownerName,
  introduction,
  contactEmail,
  onLanguageChange,
  onContinue,
}: {
  language: AppLanguage
  /** The town owner's name and introduction in `language`. */
  ownerName: string
  introduction: string
  contactEmail: string | null
  onLanguageChange: (language: AppLanguage) => void
  onContinue: () => void
}) {
  const copy = languageCopy[language].introduction
  return (
    <div className="entry-scrim">
      <section
        className="entry-card introduction-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="introduction-title"
        aria-describedby="introduction-text"
      >
        <LanguageSelect language={language} className="entry-language-select" onChange={onLanguageChange} />
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="introduction-title">{ownerName}</h1>
        <p id="introduction-text" className="entry-copy introduction-text">
          {introduction}
        </p>
        {contactEmail && (
          <OwnerContactLink
            language={language}
            ownerName={ownerName}
            email={contactEmail}
            className="introduction-contact"
          />
        )}
        <button autoFocus className="primary-button guest-button" type="button" onClick={onContinue}>
          {copy.continue}
          <span aria-hidden="true">→</span>
        </button>
      </section>
    </div>
  )
}
