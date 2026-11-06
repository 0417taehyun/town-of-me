import { useState, type FormEvent } from 'react'
import type { GuestbookEntry } from '../data/guestbook'
import { clampGuestbookPage, GUESTBOOK_MESSAGE_LIMIT, guestbookMessageForLanguage } from '../data/guestbook'
import type { OwnGuestbookEntry } from '../data/guestbookApi'
import type { PlayerProfile } from '../data/playerProfile'
import type { LoadStatus } from '../hooks/useRetryableLoad'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { GraphicsCanvas } from '../scene/GraphicsCanvas'
import { ProceduralCharacter } from '../scene/characters/ProceduralCharacter'
import { CloseButton } from './CloseButton'
import { initialGuestbookMessage, sendFailure, sendFeedback, type SendState } from './guestbookSending'
import { PrivacyLink } from './PrivacyLink'
import { useGuestbook } from './useGuestbook'

export interface GuestbookBoardProps {
  language: AppLanguage
  currentProfile: PlayerProfile
  onClose: () => void
}

export function GuestbookBoard(props: GuestbookBoardProps) {
  const guestbook = useGuestbook()
  return <GuestbookPanel {...props} {...guestbook} />
}

export interface GuestbookPanelProps extends GuestbookBoardProps {
  status: LoadStatus
  entries: GuestbookEntry[]
  /** This browser's latest entry, which other visitors see only after the admin approves it. */
  own: OwnGuestbookEntry | null
  retry: () => void
  write: (message: string, language: AppLanguage, profile: PlayerProfile) => Promise<void>
}

export function GuestbookPanel({
  language,
  status,
  entries,
  own,
  currentProfile,
  retry,
  write,
  onClose,
}: GuestbookPanelProps) {
  const copy = languageCopy[language].guestbook
  const [page, setPage] = useState(0)
  const [writing, setWriting] = useState(false)
  const [message, setMessage] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const visiblePage = clampGuestbookPage(page, entries.length)
  const entry = entries[visiblePage]
  const revising = Boolean(own?.revisable)
  const feedback = sendFeedback(sendState, copy)
  const submitLabel = revising ? copy.revise : copy.publish

  const startWriting = () => {
    setMessage(initialGuestbookMessage(own, language))
    setSendState('idle')
    setWriting(true)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedMessage = message.trim()
    if (!trimmedMessage) return
    setSendState('sending')
    const result = await write(trimmedMessage, language, currentProfile).then((): SendState => 'sent', sendFailure)
    setSendState(result)
    if (result === 'sent') setWriting(false)
    // The server knows of today's entry even when this tab does not, so reload it to offer revising it.
    if (result === 'already-written') retry()
  }

  return (
    <div
      className="panel-scrim guestbook-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="guestbook-panel" role="dialog" aria-modal="true" aria-labelledby="guestbook-title">
        <CloseButton autoFocus onClick={onClose} label={copy.close} />
        <header>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 id="guestbook-title">{copy.title}</h2>
          <p>{copy.intro}</p>
        </header>
        <div className="guestbook-board-surface">
          <i className="guestbook-corner guestbook-corner-left" aria-hidden="true" />
          <i className="guestbook-corner guestbook-corner-right" aria-hidden="true" />
          {entry && (
            <article className="guestbook-note">
              <i className="guestbook-pin" aria-hidden="true" />
              <div className="guestbook-avatar" aria-label={copy.characterLabel(entry.name)}>
                <GraphicsCanvas
                  language={language}
                  preview
                  frameloop="demand"
                  dpr={[1, 1.15]}
                  camera={{ position: [0, 1.2, 5.2], fov: 32 }}
                  onCreated={({ camera }) => camera.lookAt(0, 1.1, 0)}
                >
                  <ambientLight intensity={1.8} />
                  <directionalLight position={[3, 5, 4]} intensity={2.4} />
                  <group position={[0, 0.87, 0]}>
                    <ProceduralCharacter profile={entry.profile} />
                  </group>
                </GraphicsCanvas>
              </div>
              <div className="guestbook-note-copy">
                <strong>{entry.name}</strong>
                <time dateTime={entry.createdAt}>
                  {new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(entry.createdAt))}
                </time>
                <p>{guestbookMessageForLanguage(entry, language)}</p>
              </div>
            </article>
          )}
          {!entry && status === 'ready' && <p className="guestbook-empty">{copy.empty}</p>}
          {status === 'loading' && (
            <p className="guestbook-empty" role="status">
              {copy.loading}
            </p>
          )}
          {status === 'error' && (
            <p className="guestbook-empty" role="alert">
              {copy.loadError}{' '}
              <button className="text-button" type="button" onClick={retry}>
                {copy.retry}
              </button>
            </p>
          )}
        </div>
        <nav className="guestbook-pagination" aria-label={copy.title}>
          <button
            type="button"
            disabled={visiblePage === 0 || !entry}
            aria-label={copy.previous}
            onClick={() => setPage(clampGuestbookPage(visiblePage - 1, entries.length))}
          >
            ←
          </button>
          <span>{copy.page(entry ? visiblePage + 1 : 0, entries.length)}</span>
          <button
            type="button"
            disabled={visiblePage >= entries.length - 1 || !entry}
            aria-label={copy.next}
            onClick={() => setPage(clampGuestbookPage(visiblePage + 1, entries.length))}
          >
            →
          </button>
        </nav>
        {own?.status === 'pending' && (
          <p className="guestbook-own">
            <strong>{copy.ownPending}</strong> {guestbookMessageForLanguage(own, language)}
          </p>
        )}
        {own?.status === 'approved' && own.revisable && <p className="guestbook-own">{copy.ownApproved}</p>}
        {feedback && !writing && (
          <p className="guestbook-own" role="status">
            {feedback}
          </p>
        )}
        {writing && (
          <form className="guestbook-form" onSubmit={(event) => void submit(event)}>
            <p className="guestbook-rules">{copy.rules}</p>
            <label>
              <span>{copy.messageLabel}</span>
              <textarea
                autoFocus
                required
                maxLength={GUESTBOOK_MESSAGE_LIMIT}
                value={message}
                placeholder={copy.placeholder}
                onChange={(event) => setMessage(event.currentTarget.value)}
              />
            </label>
            <small>
              {message.length} / {GUESTBOOK_MESSAGE_LIMIT}
            </small>
            {feedback && (
              <p className="guestbook-form-error" role="alert">
                {feedback}
              </p>
            )}
            <div>
              <button className="text-button" type="button" onClick={() => setWriting(false)}>
                {copy.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!message.trim() || sendState === 'sending'}>
                {sendState === 'sending' ? copy.sending : submitLabel}
              </button>
            </div>
          </form>
        )}
        {!writing && status === 'ready' && (
          <button className="primary-button compact guestbook-write-button" type="button" onClick={startWriting}>
            <span aria-hidden="true">✎</span>
            {revising ? copy.reviseNote : `${copy.leaveNote} · ${currentProfile.name}`}
          </button>
        )}
        <p className="guestbook-privacy">
          <PrivacyLink language={language} />
        </p>
      </section>
    </div>
  )
}
