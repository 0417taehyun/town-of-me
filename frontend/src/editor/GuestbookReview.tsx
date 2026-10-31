import { useState } from 'react'
import { guestbookMessageForLanguage } from '../data/guestbook'
import {
  approveGuestbookEntry,
  deleteGuestbookEntry,
  fetchGuestbookForReview,
  type ReviewedGuestbookEntry,
} from '../data/guestbookApi'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { CloseButton } from '../ui/CloseButton'
import { isStaleReview, reviewOrder } from './guestbookReviewing'

type Copy = (typeof languageCopy)[AppLanguage]['review']

export function ReviewItem({
  entry,
  language,
  copy,
  busy,
  onApprove,
  onRemove,
}: {
  entry: ReviewedGuestbookEntry
  language: AppLanguage
  copy: Copy
  busy: boolean
  onApprove: () => void
  onRemove: () => void
}) {
  return (
    <li className={`guestbook-review-item is-${entry.status}`}>
      <div>
        <strong>{entry.name}</strong>
        <time dateTime={entry.updatedAt}>
          {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(entry.updatedAt),
          )}
        </time>
        <span className="guestbook-review-status">{copy.statuses[entry.status]}</span>
      </div>
      <p>{guestbookMessageForLanguage(entry, language)}</p>
      <div className="editor-actions">
        {entry.status === 'pending' && (
          <button className="primary-button editor-primary" type="button" disabled={busy} onClick={onApprove}>
            {copy.approve}
          </button>
        )}
        <button className="text-button danger" type="button" disabled={busy} onClick={onRemove}>
          {copy.remove}
        </button>
      </div>
    </li>
  )
}

/** Visitors write anonymously, so nothing reaches the public board until the admin approves it here. */
export function GuestbookReview({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  const copy = languageCopy[language].review
  const { status, latest, retry, update } = useRetryableLoad(fetchGuestbookForReview)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const entries = status === 'ready' ? reviewOrder(latest ?? []) : []

  /** `action` resolves to how the list changes, applied to the latest list in case another action finished first. */
  const act = async (
    entry: ReviewedGuestbookEntry,
    action: () => Promise<(entries: ReviewedGuestbookEntry[]) => ReviewedGuestbookEntry[]>,
  ) => {
    setBusyId(entry.id)
    setFailure(null)
    try {
      update(await action())
    } catch (error) {
      reportFailure(error)
    } finally {
      setBusyId(null)
    }
  }
  const reportFailure = (error: unknown) => {
    setFailure(isStaleReview(error) ? copy.changed : copy.failed)
    if (isStaleReview(error)) retry()
  }
  const approve = (entry: ReviewedGuestbookEntry) =>
    act(entry, async () => {
      const approved = await approveGuestbookEntry(entry)
      return (current) => current.map((item) => (item.id === approved.id ? approved : item))
    })
  const remove = (entry: ReviewedGuestbookEntry) => {
    if (!window.confirm(copy.deleteConfirm)) return
    void act(entry, async () => {
      await deleteGuestbookEntry(entry.id)
      return (current) => current.filter(({ id }) => id !== entry.id)
    })
  }

  return (
    <div
      className="panel-scrim guestbook-review-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="guestbook-review" role="dialog" aria-modal="true" aria-labelledby="guestbook-review-title">
        <CloseButton autoFocus onClick={onClose} label={copy.close} />
        <h2 id="guestbook-review-title">{copy.title}</h2>
        <p className="editor-note">{copy.intro}</p>
        {failure && (
          <p className="editor-field-error" role="alert">
            {failure}
          </p>
        )}
        {status === 'loading' && <p role="status">{copy.loading}</p>}
        {status === 'error' && (
          <p role="alert">
            {copy.loadError}{' '}
            <button className="text-button" type="button" onClick={retry}>
              {copy.retry}
            </button>
          </p>
        )}
        {status === 'ready' && entries.length === 0 && <p>{copy.empty}</p>}
        <ul className="guestbook-review-list">
          {entries.map((entry) => (
            <ReviewItem
              key={entry.id}
              entry={entry}
              language={language}
              copy={copy}
              busy={busyId === entry.id}
              onApprove={() => void approve(entry)}
              onRemove={() => remove(entry)}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
