import { type FormEvent, useState } from 'react'
import type { ListingChoice, OwnBoardEntry } from '../../data/leaderboardApi'
import { linkedInAddressText, normalizeLinkedInProfileUrl } from '../../data/linkedInProfile'
import type { PlayerProfile } from '../../data/playerProfile'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { copyText } from '../../scene/webglSupport'
import { PrivacyLink } from '../../ui/PrivacyLink'
import { type ListingFailure, listingChoice, type ListingForm, listingProblem, saveFailure } from '../flow/rankedRun'
import { recordText } from '../../data/boardRecord'
import { linkedInStatusText } from './derbyCues'

/**
 * The visitor's own record on this week's board, read at the computer rather than from the plate: off the board, it
 * asks first (nothing ticked beforehand), with what posting shows, where, and for how long; on it, the same form changes
 * the name, takes the record off, or turns the statue's LinkedIn link on or off. The name is the board's own, at first
 * the character's; left empty, the record shows as an anonymous batter without the character. The link offered is the
 * one the visitor's character already has, and only with the box saying it is theirs; once saved, the code the admin
 * looks for on the profile shows here. The record can also be deleted, every season of it (DeleteOwnRecords).
 */
export function ListingView({
  entry,
  batter,
  name,
  language,
  onSave,
  onDelete,
  onClose,
}: {
  entry: OwnBoardEntry
  batter: PlayerProfile
  name: string | null
  language: AppLanguage
  onSave: (choice: ListingChoice) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const copy = languageCopy[language].baseball.board
  const linkedInAddress = normalizeLinkedInProfileUrl(batter.linkedInProfileUrl)
  const linkedInOffered = !entry.takedown && (linkedInAddress !== null || entry.linkedIn !== null)
  const [form, setForm] = useState<ListingForm>(() => ({
    listed: entry.listed,
    name: (entry.listed ? entry.name : name) ?? '',
    linkedInOn: entry.linkedIn !== null,
    ownProfile: entry.linkedIn !== null,
  }))
  const [failure, setFailure] = useState<ListingFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const change = (patch: Partial<ListingForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setFailure(null)
  }
  const record = recordText(entry.homeRuns, entry.totalDistanceDm, language)
  const rank = entry.rank ?? 0
  // A posted record among the first three shows to others only once the admin has approved it.
  const onBoard = entry.awaitingApproval ? copy.onBoardAwaiting : copy.onBoard

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = listingProblem(form, entry.listed)
    setFailure(problem)
    if (problem) return
    setBusy(true)
    const choice = listingChoice(form, batter, linkedInAddress, entry.linkedIn !== null)
    await onSave(choice).catch((error: unknown) => setFailure(saveFailure(error, choice)))
    setBusy(false)
  }
  const copyCode = async (code: string) => setCopied(await copyText(code, navigator.clipboard))

  return (
    <section className="baseball-card derby-listing" aria-labelledby="derby-listing-title">
      <h1 id="derby-listing-title">{entry.listed ? copy.ownTitle : copy.consentTitle}</h1>
      <p className="derby-listing-record">{entry.listed ? onBoard(record, rank) : copy.wouldBe(record, rank)}</p>
      {entry.listed && entry.nameStatus && entry.nameStatus !== 'approved' && (
        <p className="baseball-note">{copy.nameStatus[entry.nameStatus]}</p>
      )}
      {entry.linkedIn && (
        <div className="derby-listing-code">
          <p>{linkedInStatusText(entry.linkedIn.status, language)}</p>
          {entry.linkedIn.status !== 'approved' && (
            <p>
              <code>{entry.linkedIn.code}</code>
              <button className="text-button" type="button" onClick={() => copyCode(entry.linkedIn?.code ?? '')}>
                {copied ? copy.copied : copy.copyCode}
              </button>
            </p>
          )}
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <label className="derby-check">
          <input
            type="checkbox"
            autoFocus
            checked={form.listed}
            onChange={(event) => change({ listed: event.target.checked })}
          />
          {copy.consentListed}
        </label>
        {!entry.listed && (
          <ul className="derby-listing-terms">
            {copy.consentTerms.map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        )}
        <label className="derby-field">
          <span>{copy.nameLabel}</span>
          <input
            type="text"
            value={form.name}
            disabled={!form.listed}
            autoComplete="off"
            aria-describedby="derby-listing-name-hint"
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <p id="derby-listing-name-hint" className="derby-field-hint">
          {copy.nameHint}
        </p>
        {linkedInOffered && (
          <fieldset className="derby-listing-linkedin" disabled={!form.listed}>
            <label className="derby-check">
              <input
                type="checkbox"
                checked={form.linkedInOn}
                onChange={(event) => change({ linkedInOn: event.target.checked })}
              />
              {copy.consentLinkedIn}
            </label>
            {form.linkedInOn && entry.linkedIn === null && (
              <>
                <ul className="derby-listing-terms">
                  {copy.linkedInTerms(linkedInAddressText(linkedInAddress ?? '')).map((term) => (
                    <li key={term}>{term}</li>
                  ))}
                </ul>
                <label className="derby-check">
                  <input
                    type="checkbox"
                    checked={form.ownProfile}
                    onChange={(event) => change({ ownProfile: event.target.checked })}
                  />
                  {copy.consentOwnership}
                </label>
              </>
            )}
          </fieldset>
        )}
        <p className="derby-listing-problem" role="alert">
          {failure && copy.problems[failure]}
        </p>
        <div className="derby-actions">
          <button className="primary-button" type="submit" disabled={busy}>
            {entry.listed ? copy.save : copy.post}
          </button>
          <button className="derby-secondary" type="button" onClick={onClose}>
            {entry.listed ? copy.done : copy.skip}
          </button>
        </div>
      </form>
      <details className="derby-listing-details">
        <summary>{copy.howUsedTitle}</summary>
        <ul>
          {copy.howUsed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>{copy.dataNotice}</p>
        <PrivacyLink language={language} />
      </details>
      <DeleteOwnRecords language={language} onDelete={onDelete} />
    </section>
  )
}

/**
 * Deletes every record of this browser, in every season, after a second press. The board's page offers it too, so a
 * record of a past week, one disqualified or held, or no record this week leaves it within reach.
 */
export function DeleteOwnRecords({ language, onDelete }: { language: AppLanguage; onDelete: () => Promise<void> }) {
  const copy = languageCopy[language].baseball.board
  return (
    <ConfirmedAction
      label={copy.deleteOwn}
      confirmText={copy.deleteOwnConfirm}
      confirmLabel={copy.deleteConfirm}
      keepLabel={copy.keep}
      failedText={copy.problems.deleteFailed}
      onConfirm={onDelete}
    />
  )
}

/** Something the visitor cannot take back, done after a second press that first says what it does. */
export function ConfirmedAction({
  label,
  confirmText,
  confirmLabel,
  keepLabel,
  failedText,
  onConfirm,
}: {
  label: string
  confirmText: string
  confirmLabel: string
  keepLabel: string
  failedText: string
  onConfirm: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const confirm = async () => {
    setBusy(true)
    setFailed(false)
    await onConfirm().then(
      () => setConfirming(false),
      () => setFailed(true),
    )
    setBusy(false)
  }
  return (
    <div className="derby-listing-delete">
      {confirming ? (
        <>
          <p role="alert">{confirmText}</p>
          <button className="derby-secondary" type="button" disabled={busy} onClick={confirm}>
            {confirmLabel}
          </button>
          <button className="text-button" type="button" onClick={() => setConfirming(false)}>
            {keepLabel}
          </button>
        </>
      ) : (
        <button className="text-button" type="button" onClick={() => setConfirming(true)}>
          {label}
        </button>
      )}
      {failed && <p role="alert">{failedText}</p>}
    </div>
  )
}
