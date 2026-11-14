import { type FormEvent, useState } from 'react'
import type { ListingChoice, OwnBoardEntry } from '../../data/leaderboardApi'
import type { PlayerProfile } from '../../data/playerProfile'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import { PrivacyLink } from '../../ui/PrivacyLink'
import {
  type ListingFailure,
  listingChoice,
  type ListingForm,
  listingProblem,
  postListing,
  signInForLinkedIn,
} from '../flow/rankedRun'
import { recordText } from '../../data/boardRecord'
import { submitLabel } from './derbyCues'

/**
 * The visitor's own record on this week's board, read at the computer rather than from the plate. Off the board, it is
 * the question a run's result asks first: post it or not now, with the place it would take and what posting shows. On
 * the board, the same form changes the name, takes the record off, or handles its LinkedIn link. The name is the
 * board's own, at first the character's; left empty, the record shows as an anonymous batter without the character.
 * A link is offered only where the deployment can verify one (`linkedInAvailable`): the visitor gives their profile's
 * address and says it is theirs, the record is posted, and the page then leaves for LinkedIn's sign-in, which the card
 * says before they go. A sign-in that cannot start leaves the record posted and says the link was not added. The
 * record can also be deleted, every season of it (DeleteOwnRecords).
 */
export function ListingView({
  entry,
  batter,
  name,
  linkedInAvailable,
  language,
  onSave,
  onLinkedInOff,
  onDelete,
  onClose,
}: {
  entry: OwnBoardEntry
  batter: PlayerProfile
  name: string | null
  linkedInAvailable: boolean
  language: AppLanguage
  onSave: (choice: ListingChoice) => Promise<void>
  onLinkedInOff: () => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const copy = languageCopy[language].baseball.board
  const [form, setForm] = useState<ListingForm>(() => ({
    name: (entry.listed ? entry.name : name) ?? '',
    linkedInOn: false,
    linkedInAddress: batter.linkedInProfileUrl,
    ownProfile: false,
  }))
  const [failure, setFailure] = useState<ListingFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const change = (patch: Partial<ListingForm>) => {
    setForm((current) => ({ ...current, ...patch }))
    setFailure(null)
  }
  const record = recordText(entry.homeRuns, entry.totalDistanceDm, language)
  const rank = entry.rank ?? 0
  const linkOffered = linkedInAvailable && !entry.takedown && entry.linkedIn === null
  // A link the record already has is handled by its own buttons, never sent again with the form.
  const asked = { ...form, linkedInOn: form.linkedInOn && linkOffered }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = listingProblem(asked)
    setFailure(problem)
    if (problem) return
    setBusy(true)
    const outcome = await postListing(listingChoice(asked, batter), onSave)
    if (outcome === 'posted') return onClose()
    // On the way to LinkedIn the card stays as it is until the page leaves.
    if (outcome === 'signingIn') return
    setFailure(outcome)
    setBusy(false)
  }
  const unlist = async () => {
    setBusy(true)
    setFailure(null)
    await onSave({ listed: false }).then(onClose, () => setFailure('saveFailed'))
    setBusy(false)
  }

  return (
    <section className="baseball-card derby-listing" aria-labelledby="derby-listing-title">
      <h1 id="derby-listing-title">{entry.listed ? copy.ownTitle : copy.consentTitle}</h1>
      <p className="derby-listing-record">{entry.listed ? copy.onBoard(record, rank) : copy.wouldBe(record, rank)}</p>
      {entry.listed && entry.nameStatus === 'rejected' && <p className="baseball-note">{copy.nameRejected}</p>}
      {!entry.listed && (
        <ul className="derby-listing-terms">
          {copy.consentTerms.map((term) => (
            <li key={term}>{term}</li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} noValidate>
        <label className="derby-field">
          <span>{copy.nameLabel}</span>
          <input
            type="text"
            value={form.name}
            autoComplete="off"
            aria-describedby="derby-listing-name-hint"
            onChange={(event) => change({ name: event.target.value })}
          />
        </label>
        <p id="derby-listing-name-hint" className="derby-field-hint">
          {copy.nameHint}
        </p>
        {entry.linkedIn && (
          <OwnLinkedIn
            linkedIn={entry.linkedIn}
            available={linkedInAvailable}
            season={null}
            language={language}
            onRemove={onLinkedInOff}
          />
        )}
        {linkOffered && (
          <fieldset className="derby-listing-linkedin">
            <label className="derby-check">
              <input
                type="checkbox"
                checked={form.linkedInOn}
                onChange={(event) => change({ linkedInOn: event.target.checked })}
              />
              {copy.consentLinkedIn}
            </label>
            {form.linkedInOn && (
              <>
                <label className="derby-field">
                  <span>{copy.linkedInAddressLabel}</span>
                  <input
                    type="url"
                    value={form.linkedInAddress}
                    autoComplete="off"
                    aria-describedby="derby-listing-link-hint"
                    onChange={(event) => change({ linkedInAddress: event.target.value })}
                  />
                </label>
                <p id="derby-listing-link-hint" className="derby-field-hint">
                  {copy.linkedInAddressHint}
                </p>
                <label className="derby-check">
                  <input
                    type="checkbox"
                    checked={form.ownProfile}
                    onChange={(event) => change({ ownProfile: event.target.checked })}
                  />
                  {copy.consentOwnership}
                </label>
                <p className="derby-field-hint">{copy.linkedInSignInNote}</p>
              </>
            )}
          </fieldset>
        )}
        <p className="derby-listing-problem" role="alert">
          {failure && copy.problems[failure]}
        </p>
        <div className="derby-actions">
          <button className="primary-button" type="submit" autoFocus disabled={busy}>
            {submitLabel(entry.listed, asked.linkedInOn, language)}
          </button>
          <button className="derby-secondary" type="button" onClick={onClose}>
            {entry.listed ? copy.done : copy.skip}
          </button>
          {entry.listed && (
            <button className="derby-secondary" type="button" disabled={busy} onClick={unlist}>
              {copy.unlist}
            </button>
          )}
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
 * The LinkedIn link on the visitor's own record: a hint of its address, where it stands, and what they can do about
 * it. An unverified link shows to nobody until they sign in with LinkedIn, which leaves this page for a moment; any
 * link can be removed. `season` names a past season's record, `null` this week's.
 */
export function OwnLinkedIn({
  linkedIn,
  available,
  season,
  language,
  onRemove,
}: {
  linkedIn: NonNullable<OwnBoardEntry['linkedIn']>
  available: boolean
  season: string | null
  language: AppLanguage
  onRemove: () => Promise<void>
}) {
  const copy = languageCopy[language].baseball.board
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = async (action: () => Promise<void>, staysBusy: boolean) => {
    setBusy(true)
    setFailed(false)
    const done = await action().then(
      () => true,
      () => false,
    )
    setFailed(!done)
    // A sign-in that started is leaving the page, so its buttons stay off.
    setBusy(done && staysBusy)
  }
  return (
    <div className="derby-listing-link">
      <p>
        <b>{linkedIn.profileHint}</b> · {copy.linkedInStatus[linkedIn.status]}
      </p>
      {linkedIn.status === 'unverified' && available && <p>{copy.linkedInSignInLeaves}</p>}
      <div className="derby-listing-link-actions">
        {linkedIn.status === 'unverified' && available && (
          <button
            className="derby-secondary"
            type="button"
            disabled={busy}
            onClick={() => run(() => signInForLinkedIn(season), true)}
          >
            {copy.linkedInSignIn}
          </button>
        )}
        <button className="text-button" type="button" disabled={busy} onClick={() => run(onRemove, false)}>
          {copy.linkedInRemove}
        </button>
      </div>
      {failed && <p role="alert">{copy.linkedInFailed}</p>}
    </div>
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
