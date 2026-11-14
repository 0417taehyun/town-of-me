import { type AppLanguage, languageCopy } from '../i18n/language'
import type { BoardRow } from './leaderboardApi'
import { linkedInAddressText } from './linkedInProfile'

// How a record on the weekly board reads wherever it shows: the derby's screens, the board's page, and the town's
// statues by the ballpark gate.

/**
 * A distance as each language writes it, in whole meters unless `fractionDigits` asks for that many decimals, kept
 * even when zero so a column of them lines up: "132 m" in English, "132m" in Korean.
 */
export function distanceText(decimetres: number, language: AppLanguage, fractionDigits = 0) {
  const format = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'meter',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
  return format.format(decimetres / 10)
}

/** A home run distance, or a dash before there is one. */
export function homeRunDistanceText(decimetres: number, language: AppLanguage, fractionDigits = 0) {
  return decimetres > 0 ? distanceText(decimetres, language, fractionDigits) : '—'
}

/** A record on the board as its places read: home runs and their total distance, to the decimeter it ranks by. */
export function recordText(homeRuns: number, totalDistanceDm: number, language: AppLanguage) {
  return languageCopy[language].baseball.board.record(homeRuns, homeRunDistanceText(totalDistanceDm, language, 1))
}

/** A record's name as the board shows it: approved, under review, or an anonymous batter. */
export function rowName(row: BoardRow, language: AppLanguage) {
  const copy = languageCopy[language].baseball.leaderboard
  if (row.nameState === 'approved' && row.name) return row.name
  return row.nameState === 'reviewing' ? copy.nameReviewing : copy.nameAnonymous
}

/** A statue's chip reads `in/<id>` beside the LinkedIn mark, decoded when it can be, so it says where it leads. */
export function linkedInChipText(profileUrl: string) {
  return linkedInAddressText(profileUrl).replace(/^linkedin\.com\//u, '')
}
