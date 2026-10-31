import { GuestbookRequestError, type ReviewedGuestbookEntry } from '../data/guestbookApi'

/** Entries waiting for review come first; each group stays newest first. */
export function reviewOrder(entries: ReviewedGuestbookEntry[]) {
  return [...entries].sort((left, right) => Number(left.status === 'approved') - Number(right.status === 'approved'))
}

/** Someone changed the entry since the list loaded, so the list must reload before the admin acts on it. */
export function isStaleReview(error: unknown) {
  return error instanceof GuestbookRequestError && error.status === 409
}
