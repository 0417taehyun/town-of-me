import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { LanguageSelect } from './LanguageSelect'

export function EntryOverlay({
  language,
  ownerName,
  onLanguageChange,
  onEnter,
  onActivateAudio,
}: {
  language: AppLanguage
  /** The town owner's name in `language`. */
  ownerName: string
  onLanguageChange: (language: AppLanguage) => void
  onEnter: () => void
  onActivateAudio: () => void
}) {
  const copy = languageCopy[language].entry

  return (
    <div className="entry-scrim">
      <section className="entry-card" role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <LanguageSelect language={language} className="entry-language-select" onChange={onLanguageChange} />
        <h1 id="entry-title">
          {copy.title(ownerName).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="entry-copy">
          {copy.description.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
        <button
          autoFocus
          className="primary-button guest-button"
          type="button"
          onPointerDown={(event) => event.button === 0 && onActivateAudio()}
          onClick={onEnter}
        >
          {copy.guest}
          <span aria-hidden="true">→</span>
        </button>
        <div className="entry-controls" aria-label={copy.controlsLabel}>
          <span>
            <kbd>WASD</kbd> {copy.move}
          </span>
          <span>
            <kbd>Hold</kbd> {copy.run}
          </span>
          <span>
            <kbd>Drag</kbd> {copy.glance}
          </span>
          <span>
            <kbd>E</kbd> {copy.interact}
          </span>
        </div>
      </section>
      <p className="entry-footnote">{copy.footnote}</p>
    </div>
  )
}
