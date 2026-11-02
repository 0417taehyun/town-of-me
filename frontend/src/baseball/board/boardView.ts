import { kstOffsetMilliseconds } from '../../data/ballparkRules'
import type { BoardOwnEntry, BoardRow } from '../../data/leaderboardApi'
import { normalizePlayerProfile, type PlayerProfile } from '../../data/playerProfile'
import { type AppLanguage, languageCopy } from '../../i18n/language'
import type { StatueLook } from '../../scene/statues/paintedStatue'
import { STATUE_RANKS } from '../../scene/statues/statueFinishes'

// What the board's page shows of its rows: the statues' looks, the visitor's own row, and the record number and mail
// a takedown request goes with (leaderboard spec §4.8: the owner's contact address, so it needs no new backend).

/** First, second, and third place's look: a character, an anonymous record's default batter, or an empty pedestal. */
export function statueLooks(podium: readonly BoardRow[]): StatueLook[] {
  return STATUE_RANKS.map((rank) => rowLook(podium.find((row) => row.rank === rank) ?? null))
}

export function rowLook(row: BoardRow | null): StatueLook {
  if (!row) return null
  return row.profile ?? 'defaultBatter'
}

/** The visitor's own public row: their record holds that place on the board. */
export function isOwnRow(row: BoardRow, own: BoardOwnEntry | null) {
  return own !== null && own.listed && own.rank === row.rank
}

/** The short record number a takedown request names: the record id's first eight characters. */
export function recordNumber(entryId: string) {
  return entryId.slice(0, 8)
}

/** A takedown request by mail to the town's owner, its subject naming the record when it has one. */
export function takedownHref(contactEmail: string, subject: string) {
  return `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`
}

/** The first look at a month's statues plays once per browser; only the month is kept, nothing personal. */
export function revealedKey(season: string) {
  return `town-of-me:board-revealed:${season}`
}

export function hasSeenReveal(season: string) {
  try {
    return window.localStorage.getItem(revealedKey(season)) !== null
  } catch {
    return true
  }
}

export function noteRevealSeen(season: string) {
  try {
    window.localStorage.setItem(revealedKey(season), '1')
  } catch {
    // Without storage the rise simply plays again next time.
  }
}

/** A look's key: the same look, handed over again by a reloaded board, keeps its statue. */
export function lookKey(look: StatueLook) {
  return look === null || look === 'defaultBatter' ? String(look) : JSON.stringify(look)
}

/** When the next season starts: midnight KST, and in English the visitor's own clock too. */
export function seasonResetText(endsAt: number, language: AppLanguage) {
  // Shifted by KST's offset and read as UTC, so the device's time zone never moves the day.
  const kstDay = new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric', timeZone: 'UTC' })
  const local = new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return languageCopy[language].baseball.leaderboard.reset(
    kstDay.format(new Date(endsAt + kstOffsetMilliseconds)),
    local.format(new Date(endsAt)),
  )
}

/**
 * The character a listing posts from the board: the look the record already has, so posting does not send it back to
 * review, and the LinkedIn link of the character this tab plays as, which is the only link the visitor can offer.
 */
export function listingBatter(own: BoardOwnEntry, sessionProfile: PlayerProfile | null): PlayerProfile {
  return normalizePlayerProfile({
    ...own.profile,
    name: own.name ?? sessionProfile?.name,
    linkedInProfileUrl: sessionProfile?.linkedInProfileUrl,
  })
}

/** What the visitor's record says first: its statue or place, where it would stand if posted, or that it is off. */
export function ownHeadline(own: BoardOwnEntry, final: boolean, month: string, language: AppLanguage) {
  const copy = languageCopy[language].baseball
  if (own.rank === null) return copy.board.excluded
  if (!own.listed) return copy.board.offBoard(own.rank)
  if (final) return copy.leaderboard.ownFinalRank(month, own.rank)
  return own.rank <= STATUE_RANKS.length ? copy.board.statue(own.rank) : copy.leaderboard.ownRank(own.rank)
}
