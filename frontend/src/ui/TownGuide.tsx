import type { TownGuideStep } from '../data/models'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'

const stepNumber: Record<Exclude<TownGuideStep, 'inactive'>, number> = {
  move: 1,
  glance: 2,
  view: 3,
  bench: 4,
  photo: 5,
  appearance: 6,
  environment: 7,
  pet: 8,
  resident: 9,
  guestbook: 10,
}
const stepCount = Object.keys(stepNumber).length

/** `ownerName` and `petName` are the town's names in `language`. */
export function TownGuide({
  language,
  step,
  ownerName,
  petName,
  attached = false,
}: {
  language: AppLanguage
  step: TownGuideStep
  ownerName: string
  petName: string
  attached?: boolean
}) {
  if (step === 'inactive') return null
  const copy = languageCopy[language].guide
  return (
    <section className={`town-guide town-guide-${step} ${attached ? 'town-guide-player' : ''}`} aria-live="polite">
      <div className="town-guide-icon" aria-hidden="true">
        🧭
      </div>
      <div>
        <small>{copy.progress(stepNumber[step], stepCount)}</small>
        <strong>{copy.title}</strong>
        <p>{copy.steps(ownerName, petName)[step]}</p>
      </div>
    </section>
  )
}
