import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  appearanceFields,
  normalizePlayerProfile,
  playerNameError,
  GENDER_IDENTITIES,
  genderDescriptionError,
  randomizePlayerAppearance,
  type GenderIdentity,
  type PlayerProfile,
} from '../data/playerProfile'
import { linkedInProfileUrlError } from '../data/linkedInProfile'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { AppearanceSection, ColorChoice } from './CharacterAppearanceControls'
import { CharacterPreviewCanvas } from './CharacterPreviewCanvas'
import { creatorValidationError, initialCreatorDraft } from './characterCreatorDraft'
import { CloseButton } from './CloseButton'

export interface CharacterCreatorProps {
  language: AppLanguage
  profile: PlayerProfile
  firstEntry: boolean
  onApply: (profile: PlayerProfile) => Promise<void>
  onCancel: () => void
  onActivateAudio: () => void
}

export function CharacterCreator({
  language,
  profile,
  firstEntry,
  onApply,
  onCancel,
  onActivateAudio,
}: CharacterCreatorProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const identityInput = useRef<HTMLInputElement>(null)
  const linkedInProfileInput = useRef<HTMLInputElement>(null)
  const fieldInputs = { name: nameInput, identity: identityInput, linkedInProfile: linkedInProfileInput }
  const [draft, setDraft] = useState(() => initialCreatorDraft(profile, firstEntry, language))
  const [rotation, setRotation] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const copy = languageCopy[language].creator
  const validationErrors: Record<string, string> = copy.errors
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const invalid = creatorValidationError(draft)
    setError(invalid ? validationErrors[invalid.error] : null)
    if (saving) return
    if (invalid) {
      fieldInputs[invalid.field].current?.focus()
      return
    }
    onActivateAudio()
    setSaving(true)
    try {
      await onApply(normalizePlayerProfile(draft))
    } catch {
      setError(copy.saveError)
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      className="creator-dialog"
      aria-labelledby="creator-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="creator-header">
          <div>
            <h2 id="creator-title">{copy.title}</h2>
          </div>
          <CloseButton label={copy.close} disabled={saving} onClick={onCancel} />
        </div>
        <div className="creator-layout">
          <section className="creator-preview" aria-label={copy.preview}>
            <div className="avatar-canvas">
              <CharacterPreviewCanvas profile={draft} degrees={rotation} />
            </div>
            <label className="preview-turn">
              {copy.turnPreview}
              <input
                type="range"
                min="-180"
                max="180"
                value={rotation}
                onChange={(event) => setRotation(Number(event.currentTarget.value))}
              />
            </label>
            <button
              type="button"
              className="randomize-button"
              disabled={saving}
              onClick={() => setDraft((current) => randomizePlayerAppearance(current))}
            >
              <span aria-hidden="true">🎲</span>
              {copy.randomize}
            </button>
            <p id="creator-error" className="creator-error" role="alert">
              {error}
            </p>
            <div className="creator-actions creator-preview-actions">
              <button className="text-button" type="button" onClick={onCancel} disabled={saving}>
                {copy.cancel}
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={saving}
                onPointerDown={(event) => event.button === 0 && onActivateAudio()}
              >
                {saving ? copy.saving : firstEntry ? copy.enterTown : copy.save}
              </button>
            </div>
          </section>
          <div className="creator-fields">
            <label className="creator-name">
              {copy.name}
              <input
                ref={nameInput}
                name="player-name"
                autoFocus
                autoComplete="off"
                maxLength={48}
                value={draft.name}
                disabled={saving}
                aria-describedby="creator-name-help creator-error"
                aria-invalid={Boolean(playerNameError(draft.name))}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.currentTarget.value })
                  setError(null)
                }}
              />
              <small id="creator-name-help">{copy.nameHelp}</small>
            </label>
            <fieldset className="creator-identity" disabled={saving} aria-describedby="identity-help">
              <legend>
                {copy.gender} <span>({copy.optional})</span>
              </legend>
              <div className="identity-select-shell">
                <select
                  className="identity-select"
                  name="gender-identity"
                  value={draft.genderIdentity}
                  aria-label={copy.gender}
                  onChange={(event) => {
                    const genderIdentity = event.currentTarget.value as GenderIdentity
                    setDraft({ ...draft, genderIdentity })
                    setError(null)
                  }}
                >
                  {GENDER_IDENTITIES.map((identity) => (
                    <option key={identity} value={identity}>
                      {copy.genderOptions[identity]}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">⌄</span>
              </div>
            </fieldset>
            {draft.genderIdentity === 'self-described' && (
              <label className="creator-identity">
                {copy.describeIdentity}
                <input
                  ref={identityInput}
                  name="gender-description"
                  value={draft.genderDescription}
                  maxLength={96}
                  disabled={saving}
                  aria-describedby="identity-help creator-error"
                  aria-invalid={Boolean(genderDescriptionError(draft.genderIdentity, draft.genderDescription))}
                  onChange={(event) => {
                    setDraft({ ...draft, genderDescription: event.currentTarget.value })
                    setError(null)
                  }}
                />
              </label>
            )}
            <p id="identity-help" className="creator-note">
              {copy.identityHelp}
            </p>
            <label className="creator-profile-url">
              <span>
                {copy.linkedInProfile} <small>({copy.optional})</small>
              </span>
              <input
                ref={linkedInProfileInput}
                name="linkedin-profile-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="url"
                placeholder={copy.linkedInProfilePlaceholder}
                value={draft.linkedInProfileUrl}
                disabled={saving}
                aria-describedby="linkedin-profile-help creator-error"
                aria-invalid={Boolean(linkedInProfileUrlError(draft.linkedInProfileUrl))}
                onChange={(event) => {
                  setDraft({ ...draft, linkedInProfileUrl: event.currentTarget.value })
                  setError(null)
                }}
              />
              <small id="linkedin-profile-help">{copy.linkedInProfileHelp}</small>
            </label>
            <fieldset disabled={saving}>
              <legend>{copy.appearance}</legend>
              <div className="creator-options">
                <details className="creator-option">
                  <summary>
                    <span>{copy.fields.skin}</span>
                    <strong>{copy.color}</strong>
                    <i aria-hidden="true" style={{ backgroundColor: draft.colors.skin }} />
                  </summary>
                  <div className="creator-option-content">
                    <ColorChoice
                      language={language}
                      field="skin"
                      value={draft.colors.skin}
                      onChange={(color) => setDraft({ ...draft, colors: { ...draft.colors, skin: color } })}
                    />
                  </div>
                </details>
                {appearanceFields.map((field) => (
                  <AppearanceSection
                    key={field}
                    language={language}
                    field={field}
                    profile={draft}
                    onChoice={(choice) => setDraft({ ...draft, [field]: choice })}
                    onColor={(color) => setDraft({ ...draft, colors: { ...draft.colors, [field]: color } })}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </form>
    </dialog>
  )
}
