import type { TownGuideStep } from '../data/models'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'

const stepNumber: Record<Exclude<TownGuideStep, 'inactive'>, number> = {
  move: 1,
  run: 2,
  glance: 3,
  view: 4,
  bench: 5,
  photo: 6,
  appearance: 7,
  environment: 8,
  pet: 9,
  resident: 10,
  guestbook: 11,
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
