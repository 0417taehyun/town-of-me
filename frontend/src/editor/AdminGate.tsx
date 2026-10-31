import { useState } from 'react'
import { beginLinkedInLogin } from '../data/adminSession'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import type { AdminAccessStatus } from './useAdminAccess'
import type { EditorStatus } from './useTownEditor'

/** Sign-in, wrong-account, and loading states shown on /admin before the editor can open. */
export function AdminGate({
  language,
  access,
  userName,
  editorStatus,
  loginFailed,
  onRetry,
  onSignOut,
}: {
  language: AppLanguage
  access: AdminAccessStatus
  userName: string | null
  editorStatus: EditorStatus
  loginFailed: boolean
  onRetry: () => void
  onSignOut: () => void
}) {
  const copy = languageCopy[language].admin
  const [error, setError] = useState<string | null>(loginFailed ? copy.loginFailed : null)
  const login = async () => {
    setError(null)
    try {
      window.location.assign(await beginLinkedInLogin())
    } catch {
      setError(copy.loginError)
    }
  }
  const failed = access === 'error' || editorStatus === 'error'
  const message = {
    disabled: null,
    checking: copy.checking,
    'signed-out': copy.intro,
    'not-admin': copy.notAdmin(userName ?? ''),
    admin: editorStatus === 'error' ? copy.loadError : copy.loadingTown,
    error: copy.sessionError,
  }[access]

  return (
    <div className="panel-scrim admin-scrim" role="presentation">
      <section className="admin-gate" role="dialog" aria-modal="true" aria-labelledby="admin-title">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 id="admin-title">{copy.title}</h2>
        <p role="status">{message}</p>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-actions">
          {access === 'signed-out' && (
            <button className="primary-button compact" type="button" onClick={() => void login()}>
              {copy.login}
            </button>
          )}
          {failed && (
            <button className="primary-button compact" type="button" onClick={onRetry}>
              {copy.retry}
            </button>
          )}
          {access === 'not-admin' && (
            <button className="primary-button compact" type="button" onClick={onSignOut}>
              {copy.signOut}
            </button>
          )}
          <a className="text-button" href="/">
            {copy.visitTown}
          </a>
        </div>
      </section>
    </div>
  )
}
