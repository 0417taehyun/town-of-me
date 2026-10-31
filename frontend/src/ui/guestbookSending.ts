import { guestbookMessageForLanguage } from '../data/guestbook'
import { GuestbookRequestError, type OwnGuestbookEntry } from '../data/guestbookApi'
import type { AppLanguage, languageCopy } from '../i18n/language'

type Copy = (typeof languageCopy)[AppLanguage]['guestbook']
export type SendState = 'idle' | 'sending' | 'sent' | 'already-written' | 'invalid' | 'error'

export function sendFailure(error: unknown): SendState {
  if (!(error instanceof GuestbookRequestError)) return 'error'
  if (error.status === 409) return 'already-written'
  return error.status === 400 ? 'invalid' : 'error'
}

export function sendFeedback(state: SendState, copy: Copy) {
  return {
    idle: null,
    sending: null,
    sent: copy.sent,
    'already-written': copy.alreadyWritten,
    invalid: copy.invalid,
    error: copy.sendError,
  }[state]
}

/** Today's entry opens for revising with its text; otherwise the visitor starts a new note. */
export function initialGuestbookMessage(own: OwnGuestbookEntry | null, language: AppLanguage) {
  return own?.revisable ? guestbookMessageForLanguage(own, language) : ''
}
