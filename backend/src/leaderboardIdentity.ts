import { randomInt } from 'node:crypto'
import { hashToken } from './auth.js'
import { linkedInProfileUrl } from './character.js'
import type { LeaderboardEntry, NameStatus } from './leaderboard.js'
import type { TownLayout } from './town.js'
import { decodeComponent, inputRecord, invalidInput } from './validation.js'

// What a record shows of its player on the public board, checked before anyone reads it: the name (a stricter check
// than the guestbook's, since a board invites impersonation and advertising) and the optional LinkedIn link.

/** Names a record cannot take, besides the town's own: they would pass for the owner or the site. */
export const reservedNames = ['관리자', '운영자', 'admin', 'official', '공식', '마을 주인'] as const

const linkedInPrefix = 'https://www.linkedin.com/in/'
// Format characters (direction overrides, zero-width joiners) and the Hangul fillers draw nothing.
const invisibleCharacter = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/u
const markRun = /\p{M}{3}/u
const mark = /\p{M}/gu
const maximumMarks = 4
const visibleCharacter = /[\p{L}\p{N}\p{S}]/u
/** Shapes of a web address or contact, looked for in the comparison form, where spacing and punctuation are gone. */
const contactInComparisonForm = [/http/u, /www/u, /\p{Nd}{8}/u]
/** A domain ending or a handle needs its punctuation, so these are looked for in the name as written. */
const contactAsWritten = [/[.。]\s*(?:com|kr|net|io)(?![\p{L}\p{N}])/iu, /@[\p{L}\p{N}_]/u]
const comparisonIgnored = /[\p{Z}\p{P}\p{S}\s]/gu
// Cyrillic and Greek letters drawn like Latin ones (a small part of Unicode TR39's confusables), each group beside the
// lowercase Latin letters they pass for, in order. Escaped, since the letters themselves would be indistinguishable here.
const confusableGroups: ReadonlyArray<readonly [string, string]> = [
  // Cyrillic capitals
  [
    '\u0410\u0412\u0415\u041A\u041C\u041D\u041E\u0420\u0421\u0422\u0425\u0423\u0406\u0408\u0405\u04C0',
    'abekmhopctxyijsl',
  ],
  // Cyrillic small letters
  ['\u0430\u0435\u043E\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u0501\u04BB\u04CF', 'aeopcyxijsdhl'],
  // Greek capitals
  ['\u0391\u0392\u0395\u0396\u0397\u0399\u039A\u039C\u039D\u039F\u03A1\u03A4\u03A5\u03A7', 'abezhikmnoptyx'],
  // Greek small letters
  ['\u03B1\u03B9\u03BA\u03BD\u03BF\u03C1\u03C5\u03C7', 'aikvopux'],
]
const confusables: Readonly<Record<string, string>> = Object.fromEntries(
  confusableGroups.flatMap(([sources, targets]) =>
    Array.from(sources, (character, index) => [character, targets[index] ?? character]),
  ),
)
const profileIdPattern = /^[\p{L}\p{N}-]{3,100}$/u
const crockfordBase32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** What a new name is compared with: the town's names and the site's, and the names already approved on the board. */
export interface NameContext {
  /** Comparison forms a name may not contain. */
  reserved: readonly string[]
  /** Comparison forms of other visitors' approved names on the same board, which a name may not equal. */
  taken: readonly string[]
}

/** What the identity checks read of the town: the names and links it shows. */
export type TownIdentity = Pick<TownLayout, 'owner' | 'residents' | 'objects'>

/** A LinkedIn link a visitor asks for, checked: the canonical address with its id percent-encoded, and the id. */
export interface LinkedInLink {
  profileUrl: string
  profileId: string
}

/**
 * The name with case, spacing, punctuation, and symbols gone and lookalike Cyrillic and Greek letters made Latin, so
 * "Ro bin", "ROBIN", and "ROBIN" spelled with a Cyrillic O (U+041E) all compare as "robin".
 */
export function comparisonForm(text: string): string {
  const latin = Array.from(text.normalize('NFKC'), (character) => confusables[character] ?? character).join('')
  return latin.toLowerCase().replace(comparisonIgnored, '')
}

/**
 * A name the board can show after approval is `pending`; one that draws nothing, stacks marks, looks like a web address
 * or contact, passes for the town or the site, or is another visitor's approved name is `rejected`. The record is kept
 * either way: a rejected name shows as an anonymous batter, and its owner may choose another. `name` is already
 * NFKC-normalized one-line text (`parseRunProfile`).
 */
export function leaderboardNameStatus(name: string, context: NameContext): Extract<NameStatus, 'pending' | 'rejected'> {
  const form = comparisonForm(name)
  const unusable =
    drawsSomethingHidden(name) ||
    !visibleCharacter.test(name) ||
    looksLikeContact(name) ||
    context.reserved.some((reserved) => form.includes(reserved)) ||
    context.taken.includes(form)
  return unusable ? 'rejected' : 'pending'
}

/** Invisible characters, or combining marks stacked three deep or more than four in all. */
export function drawsSomethingHidden(text: string): boolean {
  return invisibleCharacter.test(text) || markRun.test(text) || (text.match(mark)?.length ?? 0) > maximumMarks
}

/** A web address, a domain, a handle, or a phone-length run of digits, however it is spaced. */
export function looksLikeContact(text: string): boolean {
  const form = comparisonForm(text)
  return contactInComparisonForm.some((shape) => shape.test(form)) || contactAsWritten.some((shape) => shape.test(text))
}

/** The site's reserved names and every name the town shows (owner, residents, house owners), as comparison forms. */
export function reservedNameForms(town: TownIdentity | null): string[] {
  return [...reservedNames, ...townNames(town)].map(comparisonForm).filter((form) => form !== '')
}

export function townNames(town: TownIdentity | null): string[] {
  if (!town) return []
  // Only houses keep an owner name.
  const houseOwners = town.objects.flatMap((object) => (object.ownerName ? [object.ownerName] : []))
  return [town.owner.name.ko, town.owner.name.en, ...town.residents.map((resident) => resident.name), ...houseOwners]
}

/** Other visitors' approved names on a board, as comparison forms; a visitor may keep reusing their own. */
export function takenNameForms(entries: readonly LeaderboardEntry[], visitorHash: string): string[] {
  return entries
    .filter((entry) => entry.visitorHash !== visitorHash && entry.nameStatus === 'approved')
    .flatMap((entry) => (entry.authorName === null ? [] : [comparisonForm(entry.authorName)]))
}

/** `{ profileUrl, ownProfile: true }`: the visitor says the profile is theirs before anyone checks the code. */
export function parseLinkedInRequest(value: unknown): LinkedInLink {
  const input = inputRecord(value, 'linkedIn')
  if (input.ownProfile !== true) throw invalidInput('linkedIn.ownProfile must be true: link only your own profile')
  return leaderboardLinkedInUrl(input.profileUrl)
}

/**
 * Stricter than the town's links: the id is decoded once and must be 3–100 letters, digits, or hyphens, so no `/`,
 * `..`, invisible character, or broken escape gets through, and it may not read like a contact either, or it would be a
 * second public name that skips the name check. Stored percent-encoded again.
 */
export function leaderboardLinkedInUrl(value: unknown): LinkedInLink {
  const canonical = linkedInProfileUrl(value)
  if (!canonical) throw invalidInput('linkedIn.profileUrl must be a LinkedIn profile link')
  const profileId = decodeComponent(canonical.slice(linkedInPrefix.length))
  if (profileId === null || !profileIdPattern.test(profileId)) {
    throw invalidInput(
      'linkedIn.profileUrl must be https://www.linkedin.com/in/<id> with a 3–100 letter, digit, or hyphen id',
    )
  }
  if (drawsSomethingHidden(profileId) || looksLikeContact(profileId)) throw invalidInput('This link cannot be used')
  return { profileUrl: `${linkedInPrefix}${encodeURIComponent(profileId)}`, profileId }
}

/** The decoded id of a stored link; the stored text itself if it does not decode, which only a hand edit could do. */
export function profileIdOf(profileUrl: string): string {
  const encoded = profileUrl.slice(linkedInPrefix.length)
  return decodeComponent(encoded) ?? encoded
}

/** The ids the town links to (residents and houses), lowercase, which no record may claim. */
export function townLinkedInIds(town: TownIdentity | null): string[] {
  if (!town) return []
  const links = [
    ...town.residents.map((resident) => resident.linkedInProfileUrl),
    ...town.objects.map((object) => object.linkedInProfileUrl),
  ]
  return links.flatMap((link) => (link ? [profileIdOf(link).toLowerCase()] : []))
}

/** Whether the town links to this profile already; LinkedIn ids compare without case. */
export function isTownProfile(town: TownIdentity | null, profileId: string): boolean {
  return townLinkedInIds(town).includes(profileId.toLowerCase())
}

/** How a blocked profile is kept: the hash of its id, never the id. */
export function linkBlockHash(profileId: string): Promise<string> {
  return hashToken(`linkedin:${profileId.toLowerCase()}`)
}

/** `TOM-` and four Crockford base32 characters: short to copy, since the admin reads it, not a secret. */
export function ownershipCode(): string {
  return `TOM-${Array.from({ length: 4 }, () => crockfordBase32[randomInt(crockfordBase32.length)]).join('')}`
}

/** Enough of the address for its owner to recognize, and too little for the next person on a shared device to use. */
export function profileHint(profileUrl: string): string {
  return `linkedin.com/in/${Array.from(profileIdOf(profileUrl)).slice(0, 2).join('')}•••`
}
