import { useState, type FormEvent } from 'react'
import { addAdminEmail, fetchAdminEmails, removeAdminEmail, type AdminEmail } from '../data/adminEmailsApi'
import { useRetryableLoad } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { CloseButton } from '../ui/CloseButton'
import { adminEmailFailure, isStaleAdminList, withAdminEmail, type AdminEmailFailure } from './adminEmailListing'

type Copy = (typeof languageCopy)[AppLanguage]['admins']
type ListChange = (admins: AdminEmail[]) => AdminEmail[]

export function AdminEmailItem({
  admin,
  language,
  copy,
  removable,
  onRemove,
}: {
  admin: AdminEmail
  language: AppLanguage
  copy: Copy
  removable: boolean
  onRemove: () => void
}) {
  return (
    <li className="guestbook-review-item">
      <div>
        <strong>{admin.email}</strong>
        {admin.current && <span className="editor-note">{copy.you}</span>}
        <time dateTime={admin.createdAt}>
          {new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(admin.createdAt))}
        </time>
      </div>
      <div className="editor-actions">
        <button
          className="text-button danger"
          type="button"
          disabled={!removable}
          aria-label={copy.removeLabel(admin.email)}
          onClick={onRemove}
        >
          {copy.remove}
        </button>
      </div>
    </li>
  )
}

/**
 * The emails whose verified LinkedIn sign-in gets the admin role. The backend refuses to remove the signed-in
 * admin's own email or the last one; both buttons are disabled here and any refusal is shown.
 */
export function AdminEmails({ language, onClose }: { language: AppLanguage; onClose: () => void }) {
  const copy = languageCopy[language].admins
  const { status, latest, retry, update } = useRetryableLoad(fetchAdminEmails)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AdminEmailFailure | null>(null)
  const admins = status === 'ready' ? (latest ?? []) : []

  const reportFailure = (error: unknown, action: 'add' | 'remove') => {
    const reason = adminEmailFailure(error, action)
    setFailure(reason)
    if (isStaleAdminList(reason)) retry()
  }
  /** Resolves to whether `work` succeeded; its change applies to the latest list in case another one finished first. */
  const run = async (action: 'add' | 'remove', work: () => Promise<ListChange>) => {
    setBusy(true)
    setFailure(null)
    try {
      update(await work())
      return true
    } catch (error) {
      reportFailure(error, action)
      return false
    } finally {
      setBusy(false)
    }
  }
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const added = await run('add', async () => {
      const admin = await addAdminEmail(draft.trim())
      return (current) => withAdminEmail(current, admin)
    })
    if (added) setDraft('')
  }
  const remove = (email: string) => {
    if (!window.confirm(copy.removeConfirm(email))) return
    void run('remove', async () => {
      await removeAdminEmail(email)
      return (current) => current.filter((admin) => admin.email !== email)
    })
  }

  return (
    <div
      className="panel-scrim guestbook-review-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="guestbook-review" role="dialog" aria-modal="true" aria-labelledby="admin-emails-title">
        <CloseButton autoFocus onClick={onClose} label={copy.close} />
        <h2 id="admin-emails-title">{copy.title}</h2>
        <p className="editor-note">{copy.intro}</p>
        <form onSubmit={(event) => void add(event)}>
          <label className="editor-field">
            <span>{copy.email}</span>
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </label>
          <div className="editor-actions">
            <button className="primary-button editor-primary" type="submit" disabled={busy || !draft.trim()}>
              {copy.add}
            </button>
          </div>
        </form>
        {failure && (
          <p className="editor-field-error" role="alert">
            {copy.failures[failure]}
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
        <ul className="guestbook-review-list">
          {admins.map((admin) => (
            <AdminEmailItem
              key={admin.email}
              admin={admin}
              language={language}
              copy={copy}
              removable={!busy && admins.length > 1 && !admin.current}
              onRemove={() => remove(admin.email)}
            />
          ))}
        </ul>
        {admins.length === 1 && <p className="editor-note">{copy.lastAdmin}</p>}
      </section>
    </div>
  )
}
