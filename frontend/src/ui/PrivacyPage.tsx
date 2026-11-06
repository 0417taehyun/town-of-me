import { useEffect, useState } from 'react'
import { initialLanguage } from '../data/languagePreference'
import type { TownSnapshot } from '../data/models'
import { contactEmailHref, fetchTownLayout } from '../data/townApi'
import { usePageLanguage } from '../hooks/usePageLanguage'
import { type AppLanguage, languageCopy } from '../i18n/language'
import { LanguageSelect } from './LanguageSelect'
import { ASSET_CREDITS_PATH, linkedLanguage, privacyFacts } from './privacyNotice'
import './privacy.css'

/** The privacy notice at `/privacy`: plain text in the town's style, reading from this origin only the town itself. */
export function PrivacyPage() {
  const [language, setLanguage] = usePageLanguage(() => linkedLanguage(window.location.search) ?? initialLanguage())
  // `undefined` until the read settles, `null` when it failed: the notice still reads without the town.
  const [town, setTown] = useState<TownSnapshot | null | undefined>(undefined)
  const copy = languageCopy[language].privacy
  const facts = privacyFacts(town ?? null, language)

  useEffect(() => {
    document.title = copy.documentTitle
  }, [copy.documentTitle])

  useEffect(() => {
    let active = true
    void fetchTownLayout()
      .catch(() => null)
      .then((read) => active && setTown(read))
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="privacy-page" tabIndex={0} aria-labelledby="privacy-title">
      <article className="entry-card privacy-card">
        <LanguageSelect language={language} className="entry-language-select" onChange={setLanguage} />
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="privacy-title">{copy.title}</h1>
        <p className="privacy-intro">{copy.intro}</p>
        <section aria-busy={town === undefined}>
          <h2>{copy.operatorTitle}</h2>
          {town !== undefined && <PrivacyOperator language={language} {...facts} />}
        </section>
        {copy.sections.map((section) => (
          <PrivacySection key={section.title} {...section} />
        ))}
        {facts.tellsOfBallpark && <PrivacySection {...copy.ballpark} />}
        <section>
          <h2>{copy.creditsTitle}</h2>
          <p>
            {copy.credits} <a href={ASSET_CREDITS_PATH}>{copy.creditsLink}</a>
          </p>
        </section>
        <a className="privacy-back" href="/">
          <span aria-hidden="true">←</span> {copy.back}
        </a>
      </article>
    </main>
  )
}

/** Who runs the town and how to reach them, or a plain line for whichever the town does not say. */
export function PrivacyOperator({
  language,
  operatorName,
  contactEmail,
}: {
  language: AppLanguage
  operatorName: string | null
  contactEmail: string | null
}) {
  const copy = languageCopy[language].privacy
  return (
    <>
      <p>{operatorName ? copy.operator(operatorName) : copy.operatorFallback}</p>
      <p>
        {contactEmail ? (
          <>
            {copy.contact} <a href={contactEmailHref(contactEmail)}>{contactEmail}</a>
          </>
        ) : (
          copy.contactFallback
        )}
      </p>
    </>
  )
}

export function PrivacySection({ title, lines }: { title: string; lines: readonly string[] }) {
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  )
}
