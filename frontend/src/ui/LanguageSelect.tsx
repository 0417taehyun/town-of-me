import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'

export function LanguageSelect({
  language,
  className,
  onChange,
}: {
  language: AppLanguage
  className: string
  onChange: (language: AppLanguage) => void
}) {
  return (
    <div
      className={`language-select ${className}`}
      role="group"
      aria-label={languageCopy[language].languageLabel}
      title={languageCopy[language].languageLabel}
    >
      <button type="button" aria-pressed={language === 'en'} onClick={() => onChange('en')}>
        <span aria-hidden="true">🇺🇸</span> English
      </button>
      <button type="button" aria-pressed={language === 'ko'} onClick={() => onChange('ko')}>
        <span aria-hidden="true">🇰🇷</span> 한국어
      </button>
    </div>
  )
}
