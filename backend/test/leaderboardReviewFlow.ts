import { isDeepStrictEqual } from 'node:util'
import {
  DomainError,
  forgetQuietReporters,
  hashToken,
  leaderboardLinkedInUrl,
  leaderboardNameStatus,
  MemoryStore,
  parseTownLayout,
  rankingMonth,
  rankingMonthStart,
  reservedNameForms,
  type Actor,
  type EntryReviewAction,
} from '../src/index.js'
import {
  fiveNormal,
  game,
  leaderboardHarness,
  minute,
  profile,
  rejection,
  resultBody,
  type Assert,
} from './leaderboardFlow.js'
import { sampleTownLayout } from './townFlow.js'

type ReviewedEntry = {
  id: string
  rank: number | null
  updatedAt: string
  name: string | null
  reviewStatus: string
  linkedIn: { profileUrl: string; status: string; code: string } | null
}
type ReviewItem = {
  kind: string
  entry: ReviewedEntry | null
  warnings: Array<{ kind: string }>
  runs: Array<{ id: string; wouldBeRank: number; result: { pitches: Array<{ power: number | null }> } | null }>
}
type PublicEntry = {
  id: string
  name: string | null
  nameState: string
  profile: Record<string, unknown>
  linkedInProfileUrl?: string
  rank?: number
}
type OwnEntry = { linkedIn: { profileHint: string; status: string; code: string } | null; name: string | null }

const seed = 404
const adminActor: Actor = { kind: 'linked', userId: 'review-admin', role: 'admin' }
const cookieOf = (token: string) => `__Host-tom_visitor=${token}`
const linkOf = (id: string) => ({ profileUrl: `https://linkedin.com/in/${id}?trk=public`, ownProfile: true })

/** A store with the ballpark open, an admin and a member signed in, and helpers to play, list, and review. */
async function reviewHarness() {
  const harness = leaderboardHarness()
  const { store, service, send, setBallpark } = harness
  await setBallpark({ visible: true, rules: fiveNormal })
  await store.seedAdminEmails(['review-admin@example.com'])
  const admin = await signedIn(store, 'review-admin')
  const member = await signedIn(store, 'review-member')
  const season = rankingMonth(Date.now())

  async function play(token: string, errorsMs: Array<number | null>, extra: object = {}, now = Date.now()) {
    const visitorHash = await hashToken(token)
    const run = await service.issueRun(game, visitorHash, now - 2 * minute, seed)
    const body = { ...resultBody(fiveNormal, seed, errorsMs), ...extra }
    return service.submitRunResult(game, visitorHash, run.id, body, now)
  }
  const own = (token: string, body: unknown, month?: string) =>
    send('PUT', `/v1/games/${game}/entries/own${month ? `?season=${month}` : ''}`, { body, cookie: cookieOf(token) })
  const act = (path: string, body: unknown, method = 'POST') =>
    send(method, `/v1/admin/games/${game}/${path}`, { body, cookie: admin })
  const entryOf = async (token: string, month = season) =>
    store.getBoardEntryByVisitor({ game, season: month }, await hashToken(token))
  async function review(): Promise<ReviewItem[]> {
    const response = await send('GET', `/v1/admin/games/${game}/review`, { cookie: admin })
    return ((await response.json()) as { items: ReviewItem[] }).items
  }
  async function podium(): Promise<PublicEntry[]> {
    return ((await (await send('GET', `/v1/games/${game}/podium`)).json()) as { podium: PublicEntry[] }).podium
  }
  async function board(month = season) {
    const response = await send('GET', `/v1/games/${game}/leaderboard?season=${month}`)
    return (await response.json()) as { podium: PublicEntry[]; ranks: PublicEntry[] }
  }
  /** Approves the record's link as the admin who saw its code on the profile. */
  async function verifyLink(token: string) {
    const entry = await entryOf(token)
    return act(`entries/${entry?.id}/linkedin-review`, { updatedAt: entry?.updatedAt, decision: 'code-verified' })
  }
  return { ...harness, admin, member, season, play, own, act, entryOf, review, podium, board, verifyLink }
}

async function signedIn(store: MemoryStore, subject: string): Promise<string> {
  const user = await store.upsertLinkedUser({
    issuer: 'https://www.linkedin.com',
    subject,
    displayName: subject,
    email: null,
    emailVerified: false,
    pictureUrl: null,
  })
  await store.assignRoleByEmail(user.id, `${subject}@example.com`)
  await store.saveSession(await hashToken(`${subject}-session`), user.id, Date.now() + 60_000)
  return `__Host-tom_session=${subject}-session`
}

/**
 * The admin's review of the monthly board: a queue led by what visitors already see, actions that only apply to the
 * version the admin read, links that show on statues only once their code is seen, reports, takedowns, and deletion.
 */
export async function checkLeaderboardReviewFlow(assert: Assert): Promise<void> {
  checkIdentityRules(assert)
  checkReportCounter(assert)
  await checkReviewActions(assert)
  await checkTakedownAndErasure(assert)
  await checkPastSeason(assert)
  await checkHallOfFame(assert)
  await checkVisitorForget(assert)
  await checkTownLinkWarning(assert)
}

/** Names that pass for the town or a contact, and link ids that hide something, never reach the board. */
function checkIdentityRules(assert: Assert): void {
  const context = { reserved: reservedNameForms(parseTownLayout(sampleTownLayout)), taken: ['juniper'] }
  const rejected = [
    ['로 빈', "the owner's Korean name, spaced"],
    ['ROBIN', "the owner's name in capitals"],
    ['R\u041EBIN', "the owner's name with a Cyrillic O (U+041E)"],
    ['Maple Fan', "a name containing a resident's"],
    ['Official Sprout', 'a name passing for the site'],
    ['JUNIPER', "another visitor's approved name"],
    ['\u1160', 'a Hangul filler alone'],
    ['Sp\u202Erout', 'a direction override'],
    ['x\u0301\u0302\u0303', 'stacked combining marks'],
    ['call 010 1234 5678', 'a phone number, spaced'],
    ['sprout.com', 'a domain'],
    ['@sprout', 'a handle'],
    ['...', 'punctuation alone'],
  ]
  for (const [name = '', label] of rejected) {
    assert(leaderboardNameStatus(name, context) === 'rejected', `${label} is rejected as a board name`)
  }
  assert(
    leaderboardNameStatus('Sprout', context) === 'pending' && leaderboardNameStatus('새싹 🌱', context) === 'pending',
    'an ordinary name waits for approval',
  )

  for (const id of ['%2F', '%2E%2E', 'sprout%E2%80%AE', '%zz', 'ab', 'sprout_sample', 'www-sprout']) {
    const refused = rejectionOf(() => leaderboardLinkedInUrl(`https://linkedin.com/in/${id}`))
    assert(refused instanceof DomainError && refused.code === 'INVALID_INPUT', `a link with the id ${id} is refused`)
  }
  const encoded = leaderboardLinkedInUrl('https://linkedin.com/in/%ec%83%88%ec%8b%b9-sample?trk=public')
  assert(
    encoded.profileId === '새싹-sample' &&
      encoded.profileUrl === 'https://www.linkedin.com/in/%EC%83%88%EC%8B%B9-sample',
    'a link is stored canonical, its id decoded once and percent-encoded again',
  )
}

/** The in-memory report counter forgets visitors whose reports are all over an hour old, and no one else. */
function checkReportCounter(assert: Assert): void {
  const now = Date.now()
  const reportTimes = new Map([
    ['quiet-reporter', [now - 61 * minute]],
    ['recent-reporter', [now - 61 * minute, now - 59 * minute]],
  ])
  forgetQuietReporters(reportTimes, now)
  assert(
    [...reportTimes.keys()].join() === 'recent-reporter',
    'the report counter drops only visitors with no report in the last hour',
  )
}

function rejectionOf(action: () => unknown): unknown {
  try {
    action()
    return null
  } catch (error) {
    return error
  }
}

async function checkReviewActions(assert: Assert): Promise<void> {
  const { store, send, admin, member, play, own, act, entryOf, review, podium, board, verifyLink } =
    await reviewHarness()
  const reviewPath = `/v1/admin/games/${game}/review`
  assert((await send('GET', reviewPath)).status === 401, 'the review queue needs a signed-in admin')
  assert((await send('GET', reviewPath, { cookie: member })).status === 403, 'a member cannot read the review queue')
  assert(
    (await send('GET', '/v1/admin/games/ballpark/review', { cookie: admin })).status === 404,
    'an unknown game has no review queue',
  )

  const players: Array<[string, Array<number | null>, string]> = [
    ['review-four', [12, -21, null, 33, -27], 'Sprout'],
    ['review-three', [12, -21, null, 33, null], 'Pebble'],
    ['review-two', [12, null, null, 33, null], 'Clover'],
    ['review-held', [12, null, null, null, null], 'Juniper'],
  ]
  for (const [token, errorsMs, name] of players) {
    await play(token, errorsMs, { profile: { ...profile, name } })
    await own(token, { listed: true, profile: { ...profile, name } })
  }
  const strongProfile = { ...profile, name: 'Juniper' }
  const held = await play('review-held', [12, -21, -8, 33, -27], {
    claimed: { homeRuns: 0, totalDistanceDm: 0 },
    profile: strongProfile,
  })
  assert(held.standing.kind === 'reviewing', 'a strong run with claimed totals the server does not reach is held')

  const leader = await entryOf('review-four')
  const statue = { updatedAt: leader?.updatedAt }
  const stale = { updatedAt: '2000-01-01T00:00:00.000Z' }
  assert(
    (await send('POST', `/v1/admin/games/${game}/entries/${leader?.id}/approval`, { body: statue, cookie: member }))
      .status === 403 &&
      (
        await send('POST', `/v1/admin/games/${game}/entries/${leader?.id}/approval`, {
          body: statue,
          origin: null,
          cookie: admin,
        })
      ).status === 403,
    'a member cannot act on a record, nor an admin from a page without an allowed origin',
  )

  const queue = await review()
  assert(
    queue.map(({ kind, entry }) => `${kind}:${entry?.rank}`).join() === 'statue:1,statue:2,statue:3,statue-run:4',
    'the queue starts with the statues already standing unreviewed, then the held run that would stand',
  )
  const heldItem = queue[3]
  assert(
    heldItem?.runs.length === 1 &&
      heldItem.runs[0]?.wouldBeRank === 1 &&
      heldItem.runs[0].result?.pitches.every((pitch) => pitch.power === null || pitch.power > 0),
    'a held run shows the admin its would-be place and the power the visitor never sees',
  )

  assert(
    (await act(`entries/${leader?.id}/approval`, { ...stale, name: 'approve' })).status === 409,
    'an approval of a version that is no longer current changes nothing',
  )
  assert(
    (await act(`entries/${leader?.id}/approval`, { ...statue, name: 'approve' })).status === 200 &&
      (await podium())[0]?.name === 'Sprout',
    'approving a statue and its name shows the name at once',
  )

  const linked = await own('review-four', { linkedIn: linkOf('sprout-sample') })
  const linkedEntry = ((await linked.json()) as { entry: OwnEntry }).entry
  assert(
    linked.status === 200 &&
      linkedEntry.linkedIn?.status === 'pending' &&
      /^TOM-[0-9A-HJKMNP-TV-Z]{4}$/u.test(linkedEntry.linkedIn.code) &&
      linkedEntry.linkedIn.profileHint === 'linkedin.com/in/sp•••',
    'turning a link on gives an ownership code and shows its owner only a hint of the address',
  )
  assert(
    (await podium())[0]?.linkedInProfileUrl === undefined &&
      (await review()).find((item) => item.entry?.id === leader?.id)?.kind === 'linkedin',
    "a statue's link stays hidden and waits in the queue until the admin sees its code",
  )
  assert((await verifyLink('review-four')).status === 200, 'the admin approves a link after seeing its code')
  assert(
    (await podium())[0]?.linkedInProfileUrl === 'https://www.linkedin.com/in/sprout-sample',
    'an approved link shows on its statue',
  )
  await own('review-held', { linkedIn: linkOf('juniper-sample') })
  await verifyLink('review-held')
  const listedBoard = await board()
  assert(
    listedBoard.ranks.length === 1 && !JSON.stringify(listedBoard.ranks).includes('juniper-sample'),
    'an approved link shows on statues only, never on the places below them',
  )

  await play('review-reporter', [12, null, null, null, null])
  const report = (token: string, body: unknown, entryId = leader?.id) =>
    send('POST', `/v1/games/${game}/entries/${entryId}/report`, { body, cookie: cookieOf(token) })
  const unreported = await entryOf('review-four')
  const ownReport = await report('review-four', { target: 'link', reason: 'mine' })
  const lurkerReport = await report('review-lurker', { target: 'name' })
  assert(
    ownReport.status === 204 &&
      lurkerReport.status === 204 &&
      (await entryOf('review-four'))?.updatedAt === unreported?.updatedAt &&
      store.entryReports.size === 0 &&
      (await podium())[0]?.linkedInProfileUrl !== undefined,
    "a report from the record's owner, or from a browser that never played, is answered the same and changes nothing",
  )
  const codeBefore = (await entryOf('review-four'))?.linkedIn?.code
  assert(
    (await report('review-reporter', { target: 'link', reason: 'mine' })).status === 204 &&
      (await podium())[0]?.linkedInProfileUrl === undefined &&
      (await entryOf('review-four'))?.linkedIn?.status === 'reported' &&
      (await entryOf('review-four'))?.linkedIn?.code !== codeBefore,
    "a profile owner's report hides the link at once and makes a new code for the next check",
  )
  const reported = await entryOf('review-four')
  await act(`entries/${reported?.id}/approval`, { updatedAt: reported?.updatedAt, name: 'approve' })
  assert(
    (await podium())[0]?.linkedInProfileUrl === undefined,
    'approving the record does not bring back a reported link',
  )
  await report('review-reporter', { target: 'name' })
  assert((await podium())[0]?.nameState === 'reviewing', 'a name report hides an approved name at once')
  const named = await entryOf('review-four')
  assert(
    (
      await act(`entries/${named?.id}/report-resolution`, {
        updatedAt: named?.updatedAt,
        target: 'name',
        resolution: 'kept',
      })
    ).status === 200 && (await podium())[0]?.name === 'Sprout',
    'keeping a reported name shows it again',
  )
  await report('review-reporter', { target: 'name' })
  assert(
    (await podium())[0]?.name === 'Sprout' &&
      [...store.entryReports.values()].filter((entry) => entry.target === 'name' && !entry.resolvedAt).length === 1,
    'a name the admin kept is not hidden by the next report, which still waits in the queue',
  )
  await play('review-critic', [12, null, null, null, null])
  await report('review-critic', { target: 'character' })
  const pictured = await entryOf('review-four')
  await act(`entries/${pictured?.id}/report-resolution`, {
    updatedAt: pictured?.updatedAt,
    target: 'character',
    resolution: 'kept',
  })
  await own('review-four', { profile: { ...profile, name: 'Sprout', hat: 'crown' } })
  const recostumed = (await podium())[0]?.profile.hat
  await report('review-critic', { target: 'character' })
  assert(
    recostumed === 'crown' && (await podium())[0]?.profile.kind === 'default',
    'a kept character covers only the appearance the admin saw: a report on a new one hides it at once',
  )

  const heldEntry = await entryOf('review-held')
  const acceptance = (body: unknown) => act(`runs/${held.run.id}/acceptance`, body)
  assert(
    (await acceptance({ updatedAt: null })).status === 409 && (await acceptance(stale)).status === 409,
    "accepting a held run from a version of the visitor's record that is not current changes nothing",
  )
  const accepted = await acceptance({ updatedAt: heldEntry?.updatedAt })
  const acceptedBody = (await accepted.json()) as { entry: ReviewedEntry }
  const statues = await podium()
  assert(
    accepted.status === 200 &&
      acceptedBody.entry.reviewStatus === 'approved' &&
      statues[0]?.id === heldEntry?.id &&
      statues.length === 3,
    'an accepted held run becomes the record at once, approved, and stands as a statue',
  )
  assert(
    (await acceptance({ updatedAt: acceptedBody.entry.updatedAt })).status === 409,
    'a held run is accepted only once',
  )

  const top = await entryOf('review-held')
  assert(
    (await act(`entries/${top?.id}/disqualification`, stale)).status === 409,
    'a disqualification of a version that is no longer current changes nothing',
  )
  await act(`entries/${top?.id}/disqualification`, { updatedAt: top?.updatedAt })
  const afterDisqualification = (await podium()).map(({ id }) => id)
  const expected = await Promise.all(['review-four', 'review-three', 'review-two'].map((token) => entryOf(token)))
  assert(
    afterDisqualification.join() === expected.map((entry) => entry?.id).join(),
    'disqualifying a statue lets the fourth record stand',
  )
  const disqualified = await entryOf('review-held')
  await act(`entries/${disqualified?.id}/disqualification`, { updatedAt: disqualified?.updatedAt }, 'DELETE')
  assert((await podium())[0]?.id === top?.id, 'undoing a disqualification puts the record back on its place')

  const renamed = await play('review-held', [12, null, null, null, null], {
    profile: { ...strongProfile, name: 'Juniper Two' },
  })
  assert(
    renamed.entry?.listed === false && (await entryOf('review-held'))?.linkedIn === null,
    'a run under another name takes the record off the board with its link',
  )
}

async function checkTakedownAndErasure(assert: Assert): Promise<void> {
  const { store, send, play, own, act, entryOf, podium, verifyLink } = await reviewHarness()
  const players: Array<[string, Array<number | null>, string]> = [
    ['erase-four', [12, -21, null, 33, -27], 'Sprout'],
    ['erase-three', [12, -21, null, 33, null], 'Pebble'],
    ['erase-two', [12, null, null, 33, null], 'Clover'],
    ['erase-one', [12, null, null, null, null], 'Thistle'],
  ]
  for (const [token, errorsMs, name] of players) {
    await play(token, errorsMs, { profile: { ...profile, name } })
    await own(token, { listed: true, profile: { ...profile, name } })
  }
  assert(
    (await own('erase-one', { linkedIn: linkOf('%EB%A9%94%EC%9D%B4%ED%94%8C-sample') })).status === 400,
    "a resident's link cannot be claimed by a record",
  )
  const filler = await own('erase-one', { listed: true, profile: { ...profile, name: '\u3164' } })
  const fillerBoard = (await (await send('GET', `/v1/games/${game}/leaderboard`)).json()) as { ranks: PublicEntry[] }
  assert(
    filler.status === 200 &&
      (await entryOf('erase-one'))?.nameStatus === 'rejected' &&
      fillerBoard.ranks[0]?.nameState === 'anonymous',
    'a name of only a Hangul filler is rejected: an anonymous batter that keeps its place',
  )

  await own('erase-three', { linkedIn: linkOf('pebble-sample') })
  await verifyLink('erase-three')
  const pebble = await entryOf('erase-three')
  const takedown = await act(`entries/${pebble?.id}/takedown`, { updatedAt: pebble?.updatedAt, blockLinkedIn: true })
  const anonymous = (await podium())[1]
  assert(
    takedown.status === 200 &&
      anonymous !== undefined &&
      anonymous.id === pebble?.id &&
      anonymous.name === null &&
      anonymous.nameState === 'anonymous' &&
      anonymous.profile.kind === 'default' &&
      anonymous.linkedInProfileUrl === undefined &&
      (await entryOf('erase-three'))?.linkedIn === null,
    'a takedown anonymises the record, statue included, and keeps its score and place',
  )
  const renamedTakedown = await own('erase-three', { listed: true, profile: { ...profile, name: 'Pebble' } })
  assert(
    renamedTakedown.status === 200 &&
      (await entryOf('erase-three'))?.authorName === null &&
      (await own('erase-three', { linkedIn: linkOf('pebble-other') })).status === 409,
    'a record taken down never shows a name or a link again',
  )
  assert(
    (await own('erase-two', { linkedIn: linkOf('pebble-sample') })).status === 400,
    'a link a takedown blocked cannot be linked by another record',
  )

  const pastMonth = '2026-01'
  const pastTime = rankingMonthStart(pastMonth) + 60 * minute
  await play('erase-two', [12, null, null, 33, null], { profile: { ...profile, name: 'Clover' } }, pastTime)
  const twoHash = await hashToken('erase-two')
  assert(
    (await send('DELETE', `/v1/games/${game}/entries/own`, { cookie: cookieOf('erase-nobody') })).status === 204 &&
      (await entryOf('erase-two')) !== null,
    "deleting one's own records never touches another visitor's",
  )
  const statuesBefore = (await podium()).map(({ id }) => id)
  const erased = await send('DELETE', `/v1/games/${game}/entries/own`, { cookie: cookieOf('erase-two') })
  assert(
    erased.status === 204 &&
      [...store.leaderboardEntries.values()].every((entry) => entry.visitorHash !== twoHash) &&
      [...store.gameRuns.values()].every((run) => run.visitorHash !== twoHash),
    "a visitor's deletion removes their runs and records of the game in every season",
  )
  const one = await entryOf('erase-one')
  const statuesAfter = (await podium()).map(({ id }) => id)
  assert(
    statuesAfter.join() === [statuesBefore[0], statuesBefore[1], one?.id].join(),
    'a deleted statue makes way for the next record',
  )
}

/** Past seasons stay as they are, but a past statue's link stays only while its owner keeps it on. */
async function checkPastSeason(assert: Assert): Promise<void> {
  const { service, play, own, entryOf, board } = await reviewHarness()
  const pastMonth = '2026-02'
  const pastTime = rankingMonthStart(pastMonth) + 60 * minute
  const visitorHash = await hashToken('past-champion')
  await play('past-champion', [12, -21, null, 33, -27], { profile: { ...profile, name: 'Sprout' } }, pastTime)
  await service.updateOwnEntry(
    game,
    visitorHash,
    { listed: true, profile: { ...profile, name: 'Sprout' } },
    null,
    pastTime,
  )
  await service.updateOwnEntry(game, visitorHash, { linkedIn: linkOf('sprout-sample') }, null, pastTime)
  const champion = await entryOf('past-champion', pastMonth)
  await service.reviewEntry(adminActor, game, champion?.id ?? '', 'linkedin-review', {
    updatedAt: champion?.updatedAt,
    decision: 'code-verified',
  })
  assert(
    (await board(pastMonth)).podium[0]?.linkedInProfileUrl === 'https://www.linkedin.com/in/sprout-sample',
    "a past season's statue keeps its approved link",
  )
  assert(
    (await own('past-champion', { listed: false }, pastMonth)).status === 400,
    "a past season's record cannot be unlisted or renamed",
  )
  assert(
    (await own('past-champion', { linkedIn: null }, pastMonth)).status === 200 &&
      (await entryOf('past-champion', pastMonth))?.linkedIn === null &&
      (await board(pastMonth)).podium[0]?.linkedInProfileUrl === undefined,
    "turning a past statue's link off deletes it",
  )
  await own('past-champion', { anonymize: true }, pastMonth)
  const anonymized = (await board(pastMonth)).podium[0]
  assert(
    anonymized?.nameState === 'anonymous' && (await entryOf('past-champion', pastMonth))?.authorName === null,
    'a past record anonymised by its owner keeps its place without a name',
  )

  const heldHash = await hashToken('past-held')
  const heldRun = await service.issueRun(game, heldHash, pastTime - 2 * minute, seed)
  const heldOutcome = await service.submitRunResult(
    game,
    heldHash,
    heldRun.id,
    { ...resultBody(fiveNormal, seed, [12, -21, null, 33, -27]), claimed: { homeRuns: 0, totalDistanceDm: 0 } },
    pastTime,
  )
  const seasonEnd = rankingMonthStart('2026-03')
  const day = 24 * 60 * minute
  const late = await rejection(() =>
    service.acceptHeldRun(adminActor, game, heldOutcome.run.id, { updatedAt: null }, seasonEnd + 8 * day),
  )
  assert(
    heldOutcome.standing.kind === 'reviewing' && late instanceof DomainError && late.code === 'CONFLICT',
    "a past season's held run cannot be accepted more than a week after the season ended",
  )
  const accepted = await service.acceptHeldRun(adminActor, game, heldOutcome.run.id, { updatedAt: null }, seasonEnd)
  const listedLate = await service.updateOwnEntry(
    game,
    heldHash,
    { listed: true, profile: { ...profile, name: 'Juniper' } },
    pastMonth,
    seasonEnd + 3 * day,
  )
  const unlistedFinal = await rejection(() =>
    service.updateOwnEntry(game, heldHash, { listed: false }, pastMonth, seasonEnd + 7 * day),
  )
  assert(
    !accepted.entry.listed &&
      listedLate.entry.listed &&
      unlistedFinal instanceof DomainError &&
      unlistedFinal.code === 'INVALID_INPUT',
    "a held run accepted after its season ended may be listed by its visitor until that season's board is final",
  )
  const takenDownLate = await service.updateOwnEntry(
    game,
    heldHash,
    { anonymize: true },
    pastMonth,
    seasonEnd + 3 * day,
  )
  assert(
    takenDownLate.entry.authorName === null && takenDownLate.entry.listed,
    'a statue still listable after its season can be taken down like any other past statue',
  )
}

/** A finished season keeps the first three of its public order, showing only what each owner still shows. */
async function checkHallOfFame(assert: Assert): Promise<void> {
  const { service, send, play, own, entryOf } = await reviewHarness()
  const january = '2026-01'
  const at = rankingMonthStart(january) + 60 * minute
  async function playAt(token: string, errorsMs: Array<number | null>, time = at) {
    await play(token, errorsMs, { profile: { ...profile, name: token } }, time)
  }
  async function stand(token: string, errorsMs: Array<number | null>) {
    await playAt(token, errorsMs)
    const listing = { listed: true, profile: { ...profile, name: token } }
    await service.updateOwnEntry(game, await hashToken(token), listing, null, at)
  }
  async function adminAct(token: string, action: EntryReviewAction, input: object) {
    const entry = await entryOf(token, january)
    await service.reviewEntry(adminActor, game, entry?.id ?? '', action, { updatedAt: entry?.updatedAt, ...input })
  }
  async function hall(cookie = 'hall-nobody') {
    const response = await send('GET', `/v1/games/${game}/hall-of-fame`, { cookie: cookieOf(cookie) })
    const text = await response.text()
    const seasons = (JSON.parse(text) as { seasons: Array<{ id: string; champions: PublicEntry[] }> }).seasons
    return { response, text, seasons, champions: seasons.find(({ id }) => id === january)?.champions ?? [] }
  }

  await playAt('hall-unlisted', [12, -21, -8, 33, -27])
  await stand('hall-out', [12, -21, -8, 33, -27])
  await adminAct('hall-out', 'disqualification', {})
  await stand('hall-first', [12, -21, null, 33, -27])
  await stand('hall-second', [12, -21, null, 33, null])
  await stand('hall-third', [12, null, null, 33, null])
  await stand('hall-fourth', [12, null, null, null, null])
  await adminAct('hall-second', 'approval', { name: 'approve' })
  for (const token of ['hall-first', 'hall-second', 'hall-third']) {
    const link = { linkedIn: linkOf(`${token}-sample`) }
    await service.updateOwnEntry(game, await hashToken(token), link, null, at)
  }
  await adminAct('hall-first', 'linkedin-review', { decision: 'code-verified' })
  await adminAct('hall-second', 'linkedin-review', { decision: 'code-verified' })
  await playAt('hall-february', [12, null, null, null, null], rankingMonthStart('2026-02') + 60 * minute)
  await play('hall-current', [12, -21, -8, 33, -27], { profile: { ...profile, name: 'hall-current' } })
  await own('hall-current', { listed: true, profile: { ...profile, name: 'hall-current' } })

  const before = await hall()
  const standing = await Promise.all(
    ['hall-first', 'hall-second', 'hall-third'].map((token) => entryOf(token, january)),
  )
  assert(
    before.seasons.map(({ id }) => id).join() === `2026-02,${january}` && before.seasons[0]?.champions.length === 0,
    "finished seasons come newest first, this month's never, and one with no public record stands empty",
  )
  assert(
    before.champions.map(({ id }) => id).join() === standing.map((entry) => entry?.id).join() &&
      before.champions.map(({ rank }) => rank).join() === '1,2,3',
    "a season's statues are its first three public records: not an unlisted or disqualified one, nor the fourth",
  )
  const hashes = await Promise.all(['hall-first', 'hall-unlisted', 'hall-out'].map((token) => hashToken(token)))
  assert(
    !hashes.some((hash) => before.text.includes(hash)) &&
      !/hall-unlisted|hall-out|hall-fourth/u.test(before.text) &&
      before.response.headers.get('Set-Cookie') === null &&
      before.response.headers.get('Cache-Control') === 'no-store' &&
      (await hall('hall-first')).text === before.text,
    'the hall of fame is the same for everyone: no visitor hash, no cookie, not kept by a cache',
  )
  assert(
    before.champions[0]?.linkedInProfileUrl === 'https://www.linkedin.com/in/hall-first-sample' &&
      before.champions[2]?.linkedInProfileUrl === undefined,
    'a champion shows a link once the admin approved it, and not while it waits',
  )

  await own('hall-first', { linkedIn: null }, january)
  assert(
    (await hall()).champions[0]?.linkedInProfileUrl === undefined,
    'a champion who turns their link off no longer shows it',
  )
  assert((await hall()).champions[1]?.name === 'hall-second', "an approved champion's name shows")
  await own('hall-second', { anonymize: true }, january)
  const named = await own('hall-second', { listed: true, profile: { ...profile, name: 'hall-second' } }, january)
  const anonymous = (await hall()).champions[1]
  assert(
    named.status === 400 &&
      anonymous?.id === standing[1]?.id &&
      anonymous?.name === null &&
      anonymous.nameState === 'anonymous' &&
      anonymous.profile.kind === 'default' &&
      anonymous.linkedInProfileUrl === undefined,
    'a champion anonymised by its owner keeps its place, shows nothing of them, and cannot take a name back',
  )
}

/** Forgetting the visitor ends this browser's hold on its records and leaves the records alone. */
async function checkVisitorForget(assert: Assert): Promise<void> {
  const { send, play, own, entryOf, board } = await reviewHarness()
  const forgetPath = '/v1/visitor/forget'
  const named = { ...profile, name: 'Sprout' }
  await play('forget-first', [12, -21, null, 33, -27], { profile: named })
  await own('forget-first', { listed: true, profile: named })
  const record = await entryOf('forget-first')
  assert(
    (await send('POST', forgetPath, { cookie: cookieOf('forget-first'), origin: null })).status === 403,
    'forgetting needs an allowed origin, like any write',
  )
  const forgotten = await send('POST', forgetPath, { cookie: cookieOf('forget-first') })
  assert(
    forgotten.status === 204 &&
      /^__Host-tom_visitor=; .*Max-Age=0$/u.test(forgotten.headers.get('Set-Cookie') ?? '') &&
      isDeepStrictEqual(await entryOf('forget-first'), record),
    'forgetting clears the visitor cookie and changes no record',
  )
  const renamed = await own('forget-next', { listed: false })
  const erased = await send('DELETE', `/v1/games/${game}/entries/own`, { cookie: cookieOf('forget-next') })
  assert(
    renamed.status === 404 &&
      erased.status === 204 &&
      isDeepStrictEqual(await entryOf('forget-first'), record) &&
      (await board()).podium[0]?.id === record?.id,
    "a browser's new cookie can neither change nor delete the record it left behind",
  )
}

/** A record's link can match the town only if the town added it later, so the queue warns the admin. */
async function checkTownLinkWarning(assert: Assert): Promise<void> {
  const { store, play, own, review, entryOf } = await reviewHarness()
  const named = (name: string) => ({ ...profile, name })
  await play('warned-owner', [12, -21, null, 33, -27], { profile: named('Sprout') })
  await own('warned-owner', { listed: true, profile: named('Sprout'), linkedIn: linkOf('Fern-sample') })
  await play('warned-other', [12, -21, null, 33, null], { profile: named('Pebble') })
  await own('warned-other', { listed: true, profile: named('Pebble'), linkedIn: linkOf('pebble-sample') })
  const warningsOf = async (token: string) => {
    const entry = await entryOf(token)
    return (await review()).find((item) => item.entry?.id === entry?.id)?.warnings.map(({ kind }) => kind) ?? []
  }
  assert(!(await warningsOf('warned-owner')).includes('town-link'), 'a link the town does not show raises no warning')
  const residents = [{ ...sampleTownLayout.residents[0], linkedInProfileUrl: 'https://linkedin.com/in/FERN-sample' }]
  const layout = parseTownLayout({ ...sampleTownLayout, residents, venues: { ballpark: { visible: true } } })
  await store.saveTown('mossbell', layout, (await store.getTown('mossbell'))?.revision ?? 0)
  assert(
    (await warningsOf('warned-owner')).includes('town-link') &&
      !(await warningsOf('warned-other')).includes('town-link'),
    "a link equal to a resident's, whatever its case, is flagged in the queue, and no one else's is",
  )
}
