import { isDeepStrictEqual } from 'node:util'
import {
  DomainError,
  forgetQuietReporters,
  hashToken,
  leaderboardLinkedInUrl,
  leaderboardNameStatus,
  MemoryStore,
  parseTownLayout,
  rankingWeek,
  rankingWeekStart,
  reservedNameForms,
  type EntryReviewAction,
  type GameRun,
  type LinkedInOidcAdapter,
  type VerifiedLinkedInIdentity,
} from '../src/index.js'
import {
  adminActor,
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
  visitor: string
  rank: number | null
  updatedAt: string
  name: string | null
  nameStatus: string | null
  disqualified: boolean
  listed: boolean
  profile: object | null
  linkedIn: { profileUrl: string; status: string; verifiedName: string | null } | null
  reports: Array<{ target: string; count: number; mine: boolean }>
}
type ReviewedRun = {
  id: string
  visitor: string
  status: string
  flags: string[]
  best: boolean
  homeRuns: number | null
  result: { pitches: Array<{ power: number | null }> } | null
}
type Plays = {
  season: string
  runs: ReviewedRun[]
  records: ReviewedEntry[]
  reported: ReviewedEntry[]
  nextCursor: string | null
}
type PublicEntry = {
  id: string
  name: string | null
  nameState: string
  profile: Record<string, unknown>
  linkedInProfileUrl?: string
  rank?: number
}
type OwnEntry = { linkedIn: { profileHint: string; status: string } | null; name: string | null }

const origin = 'https://town.example'
const seed = 404
const cookieOf = (token: string) => `__Host-tom_visitor=${token}`
const linkOf = (id: string) => ({ profileUrl: `https://linkedin.com/in/${id}?trk=public`, ownProfile: true })
/** What LinkedIn says of the account that signs in: everything but the display name must stay out of storage. */
const linkedInAccount: VerifiedLinkedInIdentity = {
  issuer: 'https://www.linkedin.com',
  subject: 'visitor-linkedin-subject',
  displayName: '  Sprout \n  Sample ',
  email: 'sprout@mail.example',
  emailVerified: true,
  pictureUrl: 'https://media.example/sprout-portrait.jpg',
}
const linkedInOidc: LinkedInOidcAdapter = {
  createAuthorizationUrl: (input) =>
    new URL(`https://www.linkedin.com/oauth/v2/authorization?state=${input.state}&scope=${input.scopes.join('+')}`),
  exchangeAndVerify: async () => linkedInAccount,
}

/** A store with the ballpark open, LinkedIn configured, an admin and a member signed in, and helpers to play and act. */
async function reviewHarness() {
  const harness = leaderboardHarness(linkedInOidc)
  const { store, service, send, setBallpark } = harness
  await setBallpark({ visible: true, rules: fiveNormal })
  await store.seedAdminEmails(['review-admin@example.com'])
  const admin = await signedIn(store, 'review-admin')
  const member = await signedIn(store, 'review-member')
  const season = rankingWeek(Date.now())

  const own = (token: string, body: unknown, week?: string) =>
    send('PUT', `/v1/games/${game}/entries/own${week ? `?season=${week}` : ''}`, { body, cookie: cookieOf(token) })
  const entryOf = async (token: string, week = season) =>
    store.getBoardEntryByVisitor({ game, season: week }, await hashToken(token))
  /** An admin's action on the visitor's record, from the version it has now. */
  async function act(token: string, path: string, body: object = {}, method = 'POST') {
    const entry = await entryOf(token)
    return send(method, `/v1/admin/games/${game}/entries/${entry?.id}/${path}`, {
      body: { updatedAt: entry?.updatedAt, ...body },
      cookie: admin,
    })
  }
  async function podium(): Promise<PublicEntry[]> {
    return ((await (await send('GET', `/v1/games/${game}/podium`)).json()) as { podium: PublicEntry[] }).podium
  }
  async function board(week = season) {
    const response = await send('GET', `/v1/games/${game}/leaderboard?season=${week}`)
    return (await response.json()) as { podium: PublicEntry[]; ranks: PublicEntry[] }
  }
  const report = async (token: string, target: string, body: object) =>
    send('POST', `/v1/games/${game}/entries/${(await entryOf(target))?.id}/report`, { body, cookie: cookieOf(token) })
  /** Starts the visitor's LinkedIn sign-in: the state LinkedIn would send back and the cookies of the browser. */
  async function startSignIn(token: string) {
    const response = await send('POST', `/v1/games/${game}/entries/own/linkedin-verification`, {
      cookie: cookieOf(token),
    })
    const body = (await response.json()) as { authorizationUrl?: string }
    const authorization = new URL(body.authorizationUrl ?? 'https://none.example')
    const linkCookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? ''
    return {
      response,
      authorization,
      state: authorization.searchParams.get('state') ?? '',
      cookies: `${cookieOf(token)}; ${linkCookie}`,
    }
  }
  /** The browser coming back from LinkedIn, as a top-level navigation: no `Origin`. */
  const callback = (state: string, cookie: string) =>
    send('GET', `/v1/auth/linkedin/callback?state=${state}&code=code`, { cookie, origin: null })
  /** Signs the visitor in for their record's link, as one who finished the round trip. */
  async function verifyLink(token: string) {
    const started = await startSignIn(token)
    return callback(started.state, started.cookies)
  }
  /** Plays, lists under `name`, and returns the record. */
  async function stand(token: string, errorsMs: Array<number | null>, name: string) {
    const named = { ...profile, name }
    await harness.play(token, errorsMs, { profile: named })
    await service.updateOwnEntry(game, await hashToken(token), { listed: true, profile: named })
    return entryOf(token)
  }
  return {
    ...harness,
    admin,
    member,
    season,
    own,
    act,
    entryOf,
    podium,
    board,
    report,
    startSignIn,
    callback,
    verifyLink,
    stand,
  }
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
 * The admin's side of the weekly board, where nothing waits for approval: a list of who played, actions that only
 * apply to the version the admin read, a link that shows once its visitor signs in with LinkedIn, reports, takedowns,
 * and deletion.
 */
export async function checkLeaderboardReviewFlow(assert: Assert): Promise<void> {
  checkIdentityRules(assert)
  checkReportCounter(assert)
  await checkRecordActions(assert)
  await checkLinkVerification(assert)
  await checkLinkReports(assert)
  await checkPlaysList(assert)
  await checkTakedownAndErasure(assert)
  await checkPastSeason(assert)
  await checkHallOfFame(assert)
  await checkVisitorForget(assert)
}

/** Names that pass for the town or a contact, and link ids that hide something, never reach the board. */
function checkIdentityRules(assert: Assert): void {
  const context = { reserved: reservedNameForms(parseTownLayout(sampleTownLayout)), taken: ['juniper'] }
  const rejected = [
    ['로 빈', "the owner's Korean name, spaced"],
    ['ROBIN', "the owner's name in capitals"],
    ['RОBIN', "the owner's name with a Cyrillic O (U+041E)"],
    ['Maple Fan', "a name containing a resident's"],
    ['Official Sprout', 'a name passing for the site'],
    ['JUNIPER', "another visitor's shown name"],
    ['ᅠ', 'a Hangul filler alone'],
    ['Sp‮rout', 'a direction override'],
    ['x́̂̃', 'stacked combining marks'],
    ['call 010 1234 5678', 'a phone number, spaced'],
    ['sprout.com', 'a domain'],
    ['@sprout', 'a handle'],
    ['...', 'punctuation alone'],
  ]
  for (const [name = '', label] of rejected) {
    assert(leaderboardNameStatus(name, context) === 'rejected', `${label} is rejected as a board name`)
  }
  assert(
    leaderboardNameStatus('Sprout', context) === 'shown' && leaderboardNameStatus('새싹 🌱', context) === 'shown',
    'an ordinary name shows at once',
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

/** What the admin does to a record afterwards: only an admin, only from the version read, and shown at once. */
async function checkRecordActions(assert: Assert): Promise<void> {
  const { store, service, send, admin, member, play, act, entryOf, podium, report, stand } = await reviewHarness()
  const leader = await stand('action-leader', [12, -21, null, 33, -27], 'Sprout')
  await stand('action-second', [12, -21, null, 33, null], 'Pebble')
  const path = `/v1/admin/games/${game}/entries/${leader?.id}/name`
  const hide = { updatedAt: leader?.updatedAt, public: false }
  assert(
    (await send('POST', path, { body: hide })).status === 401 &&
      (await send('POST', path, { body: hide, cookie: member })).status === 403 &&
      (await send('POST', path, { body: hide, cookie: admin, origin: null })).status === 403 &&
      (await podium())[0]?.name === 'Sprout',
    'only an admin acts on a record, and only from a page with an allowed origin',
  )
  assert(
    (await act('action-leader', 'name', { updatedAt: '2000-01-01T00:00:00.000Z', public: false })).status === 409 &&
      (await act('action-leader', 'name', { public: 'no' })).status === 400 &&
      (await podium())[0]?.name === 'Sprout',
    'an action on a version that is no longer current, or a malformed one, changes nothing',
  )
  const hidden = await act('action-leader', 'name', { public: false })
  const answered = ((await hidden.json()) as { entry: ReviewedEntry }).entry
  const anonymous = (await podium())[0]
  assert(
    hidden.status === 200 &&
      answered.name === 'Sprout' &&
      answered.nameStatus === 'rejected' &&
      answered.rank === 1 &&
      anonymous?.id === leader?.id &&
      anonymous?.name === null &&
      anonymous.profile.kind === 'default',
    'taking a name off leaves an anonymous batter on the same place, and the admin still reads the name',
  )
  await act('action-leader', 'name', { public: true })
  await act('action-leader', 'appearance', { public: false })
  const named = (await podium())[0]
  assert(
    named?.name === 'Sprout' && named.profile.kind === 'default',
    'the admin puts a name back, and hides a character while the name stays',
  )

  await play('action-reporter', [12, null, null, null, null])
  const lurkerHash = await hashToken('action-lurker')
  const lurkerRun = await service.issueRun(game, lurkerHash, Date.now(), seed)
  await rejection(() =>
    service.submitRunResult(game, lurkerHash, lurkerRun.id, resultBody(fiveNormal, seed, [10, 10, 10, 10, 10]), true),
  )
  const unreported = await entryOf('action-second')
  const ownReport = await report('action-second', 'action-second', { target: 'name' })
  const lurkerReport = await report('action-lurker', 'action-second', { target: 'name' })
  assert(
    ownReport.status === 204 && lurkerReport.status === 204 && store.entryReports.size === 0,
    "a report from the record's owner, or from a browser whose only run was refused as too fast, is answered the same and counts for nothing",
  )
  await report('action-reporter', 'action-second', { target: 'name' })
  await report('action-reporter', 'action-second', { target: 'character' })
  assert(
    [...store.entryReports.values()].length === 2 &&
      (await podium())[1]?.name === 'Pebble' &&
      (await podium())[1]?.profile.kind !== 'default' &&
      (await entryOf('action-second'))?.updatedAt === unreported?.updatedAt,
    'a report on a name or a character is stored for the admin and hides nothing',
  )
  const resolved = await act('action-second', 'report-resolution', { target: 'name', resolution: 'removed' })
  const afterResolution = ((await resolved.json()) as { entry: ReviewedEntry }).entry
  assert(
    (await podium())[1]?.name === null &&
      afterResolution.reports.map(({ target }) => target).join() === 'character' &&
      [...store.entryReports.values()].filter((entry) => entry.resolvedAt === null).length === 1,
    'removing a reported name takes it off and closes the reports on it, and no others',
  )
}

/**
 * A link is asked with the listing, stored unseen, and made public by its visitor's LinkedIn sign-in, which is tied to
 * the visitor cookie and the record, used once, and never makes a user or a session.
 */
async function checkLinkVerification(assert: Assert): Promise<void> {
  const unconfigured = leaderboardHarness()
  await unconfigured.setBallpark({ visible: true, rules: fiveNormal })
  await unconfigured.play('link-unconfigured', [12, null, null, null, null])
  const plainListing = { listed: true, profile }
  const refused = await unconfigured.send('PUT', `/v1/games/${game}/entries/own`, {
    body: { ...plainListing, linkedIn: linkOf('sprout-sample') },
    cookie: cookieOf('link-unconfigured'),
  })
  const listedWithout = await unconfigured.send('PUT', `/v1/games/${game}/entries/own`, {
    body: { ...plainListing, linkedIn: null },
    cookie: cookieOf('link-unconfigured'),
  })
  const startedWithout = await unconfigured.send('POST', `/v1/games/${game}/entries/own/linkedin-verification`, {
    cookie: cookieOf('link-unconfigured'),
  })
  const unconfiguredBoard = (await (await unconfigured.send('GET', `/v1/games/${game}/leaderboard`)).json()) as {
    linkedInAvailable: boolean
  }
  assert(
    unconfiguredBoard.linkedInAvailable === false &&
      refused.status === 503 &&
      startedWithout.status === 503 &&
      listedWithout.status === 200,
    'without LinkedIn configured the board says a link is unavailable, and a record still lists without one',
  )

  const { store, service, send, own, entryOf, podium, startSignIn, callback, stand, warnings } = await reviewHarness()
  await stand('link-owner', [12, -21, null, 33, -27], 'Sprout')
  await stand('link-other', [12, -21, null, 33, null], 'Pebble')
  const linked = await own('link-owner', { listed: true, profile: { ...profile, name: 'Sprout' }, ...linkRequest() })
  const linkedEntry = ((await linked.json()) as { entry: OwnEntry }).entry
  const configuredBoard = (await (await send('GET', `/v1/games/${game}/leaderboard`)).json()) as {
    linkedInAvailable: boolean
  }
  assert(
    configuredBoard.linkedInAvailable &&
      isDeepStrictEqual(linkedEntry.linkedIn, { profileHint: 'linkedin.com/in/sp•••', status: 'unverified' }) &&
      (await podium())[0]?.linkedInProfileUrl === undefined,
    'a link sent with the listing is stored but shown to nobody before its visitor signs in, and its owner sees only a hint',
  )

  const usersBefore = store.users.size
  const sessionsBefore = store.sessions.size
  const startPath = `/v1/games/${game}/entries/own/linkedin-verification`
  assert(
    (await send('POST', startPath)).status === 404 &&
      (await send('POST', startPath, { cookie: cookieOf('link-owner'), origin: null })).status === 403 &&
      (await startSignIn('link-other')).response.status === 409,
    'a sign-in starts only from an allowed page, for the browser that has a record with a link waiting',
  )
  const failed = `${origin}/baseball/ranking?linkedin=failed`
  const unchanged = async () =>
    (await entryOf('link-owner'))?.linkedIn?.status === 'unverified' &&
    (await podium())[0]?.linkedInProfileUrl === undefined

  const wrongState = await startSignIn('link-owner')
  assert(
    wrongState.response.status === 200 &&
      wrongState.state.startsWith('link.') &&
      wrongState.authorization.searchParams.get('scope') === 'openid profile' &&
      /^__Host-tom_link=.+; Secure; HttpOnly; SameSite=Lax; Path=\/; Max-Age=600$/u.test(
        wrongState.response.headers.get('Set-Cookie') ?? '',
      ),
    "a sign-in asks LinkedIn for no email and keeps its id in an HttpOnly cookie of its own, apart from the admin sign-in's",
  )
  const forged = await callback('link.forged-state', wrongState.cookies)
  assert(
    forged.status === 302 && forged.headers.get('Location') === failed && (await unchanged()),
    'a callback with a state that is not the started one changes nothing',
  )
  const usedUp = await callback(wrongState.state, wrongState.cookies)
  assert(
    usedUp.headers.get('Location') === failed && (await unchanged()),
    'a sign-in a failed callback used up cannot be finished afterwards',
  )

  const stolen = await startSignIn('link-owner')
  const linkCookie = stolen.cookies.split('; ')[1] ?? ''
  const otherVisitor = await callback(stolen.state, `${cookieOf('link-other')}; ${linkCookie}`)
  const cookieless = await startSignIn('link-owner')
  const noVisitor = await callback(cookieless.state, cookieless.cookies.split('; ')[1] ?? '')
  assert(
    otherVisitor.headers.get('Location') === failed &&
      noVisitor.headers.get('Location') === failed &&
      (await unchanged()),
    "a callback from another visitor's browser, or from one without the visitor cookie, changes nothing",
  )

  const ownerHash = await hashToken('link-owner')
  const startedAt = Date.now()
  const slow = await service.beginLinkVerification(linkedInOidc, game, ownerHash, null, startedAt)
  const slowState = new URL(slow.authorizationUrl).searchParams.get('state') ?? ''
  const expired = await rejection(() =>
    service.completeLinkVerification(
      linkedInOidc,
      { transactionId: slow.transactionId, state: slowState, code: 'code' },
      ownerHash,
      startedAt + 11 * minute,
    ),
  )
  assert(
    expired instanceof DomainError && expired.code === 'FORBIDDEN' && (await unchanged()),
    'a callback more than ten minutes after the start changes nothing',
  )

  const moved = await startSignIn('link-owner')
  await own('link-owner', linkRequest('sprout-elsewhere'))
  const movedCallback = await callback(moved.state, moved.cookies)
  assert(
    movedCallback.headers.get('Location') === failed &&
      (await entryOf('link-owner'))?.linkedIn?.status === 'unverified' &&
      warnings.every((warning) => !warning.includes(linkedInAccount.email ?? 'no email')),
    'a sign-in started for one address does not verify another the record took meanwhile',
  )
  await own('link-owner', linkRequest())

  const valid = await startSignIn('link-owner')
  const verified = await callback(valid.state, valid.cookies)
  const setCookies = verified.headers.getSetCookie()
  assert(
    verified.status === 302 &&
      verified.headers.get('Location') === `${origin}/baseball/ranking?linkedin=verified` &&
      verified.headers.get('Cache-Control') === 'no-store' &&
      setCookies.length === 1 &&
      /^__Host-tom_link=; .*Max-Age=0$/u.test(setCookies[0] ?? ''),
    "a valid callback returns the browser to the board page of the frontend's own origin with only an outcome mark, and clears its cookie",
  )
  assert(
    (await podium())[0]?.linkedInProfileUrl === 'https://www.linkedin.com/in/sprout-sample',
    'after a valid callback the link is public at once',
  )
  const stored = JSON.stringify([...store.leaderboardEntries.values()])
  assert(
    isDeepStrictEqual((await entryOf('link-owner'))?.linkedIn, {
      profileUrl: 'https://www.linkedin.com/in/sprout-sample',
      status: 'verified',
      verifiedName: 'Sprout Sample',
    }) &&
      !stored.includes(linkedInAccount.subject) &&
      !stored.includes('mail.example') &&
      !stored.includes('media.example'),
    "only the signed-in account's display name is stored on the record: no subject, email, or picture",
  )
  assert(
    store.users.size === usersBefore && store.sessions.size === sessionsBefore && store.linkVerifications.size === 0,
    'a link sign-in makes no user and no session, and leaves no verification behind',
  )
  const replayed = await callback(valid.state, valid.cookies)
  assert(
    replayed.headers.get('Location') === failed &&
      (await startSignIn('link-owner')).response.status === 409 &&
      (await entryOf('link-owner'))?.linkedIn?.status === 'verified',
    'a callback sent again does nothing, and a verified link starts no new sign-in',
  )
  const belowStatues = await send('GET', `/v1/games/${game}/leaderboard`, { cookie: cookieOf('link-owner') })
  assert(
    !(await belowStatues.text()).includes('Sprout Sample'),
    "the display name is for the admin only: neither the board nor the record's own view carries it",
  )
}

function linkRequest(id = 'sprout-sample') {
  return { linkedIn: linkOf(id) }
}

/**
 * A profile owner's report hides a link at once, and nothing its record's visitor does brings it back before the admin
 * decides; the admin restores it, or takes it down and blocks it.
 */
async function checkLinkReports(assert: Assert): Promise<void> {
  const { store, play, own, act, entryOf, podium, report, startSignIn, verifyLink, stand } = await reviewHarness()
  await stand('claim-owner', [12, -21, null, 33, -27], 'Sprout')
  await stand('claim-second', [12, -21, null, 33, null], 'Pebble')
  await play('claim-reporter', [12, null, null, null, null])
  await own('claim-owner', linkRequest())
  await verifyLink('claim-owner')
  const shown = async () => (await podium())[0]?.linkedInProfileUrl !== undefined

  await report('claim-reporter', 'claim-owner', { target: 'link', reason: 'other' })
  assert(
    store.entryReports.size === 1 && (await shown()),
    'a link report from someone who does not say the profile is theirs is stored and leaves the link showing',
  )
  await report('claim-reporter', 'claim-owner', { target: 'link', reason: 'mine' })
  assert(
    !(await shown()) && (await entryOf('claim-owner'))?.linkedIn?.status === 'reported',
    "a profile owner's report hides the link at once",
  )
  const resent = await own('claim-owner', linkRequest())
  const signIn = await startSignIn('claim-owner')
  await own('claim-owner', { linkedIn: null })
  const readded = await own('claim-owner', linkRequest())
  assert(
    resent.status === 409 &&
      signIn.response.status === 409 &&
      readded.status === 409 &&
      (await entryOf('claim-owner'))?.linkedIn === null,
    'while that report is open the record takes no link: sending it again, signing in, or turning it off and on',
  )

  await own('claim-second', linkRequest('pebble-sample'))
  await verifyLink('claim-second')
  await report('claim-reporter', 'claim-second', { target: 'link', reason: 'mine' })
  const kept = await act('claim-second', 'report-resolution', { target: 'link', resolution: 'kept' })
  const restored = ((await kept.json()) as { entry: ReviewedEntry }).entry
  assert(
    restored.linkedIn?.status === 'verified' &&
      restored.linkedIn.verifiedName === 'Sprout Sample' &&
      restored.reports.length === 0 &&
      (await podium())[1]?.linkedInProfileUrl === 'https://www.linkedin.com/in/pebble-sample',
    "the admin's keeping a reported link shows it again at once and closes its reports",
  )

  await report('claim-reporter', 'claim-second', { target: 'link', reason: 'other' })
  const removal = await act('claim-second', 'linkedin-removal', { blockLinkedIn: true })
  const removedEntry = ((await removal.json()) as { entry: ReviewedEntry }).entry
  assert(
    removal.status === 200 &&
      removedEntry.linkedIn === null &&
      removedEntry.reports.length === 0 &&
      (await podium())[1]?.linkedInProfileUrl === undefined &&
      (await act('claim-second', 'linkedin-removal')).status === 409,
    'taking a link down deletes it at once and closes the reports on it',
  )
  assert(
    (await own('claim-second', linkRequest('PEBBLE-sample'))).status === 400 &&
      (await own('claim-second', linkRequest('pebble-other'))).status === 200,
    'a link taken down with a block cannot be linked again by any record, whatever its case, and another address can',
  )
}

/**
 * The admin's list: a board's runs of every status, newest first, a page at a time, with the records of the visitors
 * on the page, and on the first page the records with open reports wherever their runs are.
 */
async function checkPlaysList(assert: Assert): Promise<void> {
  const { store, service, send, admin, member, play, entryOf } = await reviewHarness()
  const week = '2026-03-02'
  const start = rankingWeekStart(week) + 60 * minute
  const at = (step: number) => start + step * 3 * minute
  const path = (query = '') => `/v1/admin/games/${game}/plays?season=${week}${query}`
  const read = async (query = '') => {
    const response = await send('GET', path(query), { cookie: admin })
    return { response, body: (await response.json()) as Plays }
  }
  assert(
    (await send('GET', path())).status === 401 &&
      (await send('GET', path(), { cookie: member })).status === 403 &&
      (await send('GET', `/v1/admin/games/ballpark/plays`, { cookie: admin })).status === 404,
    'only an admin reads who played, and an unknown game has no list',
  )

  const named = { ...profile, name: 'Sprout' }
  const first = await play('plays-reported', [12, -21, null, 33, -27], { profile: named }, at(0))
  await service.updateOwnEntry(game, await hashToken('plays-reported'), { listed: true, profile: named }, week, at(0))
  const weaker = await play('plays-reported', [12, null, null, null, null], { profile: named }, at(1))
  const marked = await play(
    'plays-marked',
    [12, -21, null, 33, null],
    { claimed: { homeRuns: 0, totalDistanceDm: 0 } },
    at(2),
  )
  const refusedHash = await hashToken('plays-refused')
  const refused = await service.issueRun(game, refusedHash, at(3), seed)
  await rejection(() =>
    service.submitRunResult(
      game,
      refusedHash,
      refused.id,
      resultBody(fiveNormal, seed, [10, 10, 10, 10, 10]),
      true,
      at(3),
    ),
  )
  const abandoned = await service.issueRun(game, await hashToken('plays-quitter'), at(4), seed)
  const open = await service.issueRun(game, await hashToken('plays-quitter'), at(5), seed)
  // A run held under the old review and never accepted, as migration 010 leaves it.
  const heldBefore: GameRun = { ...marked.run, id: crypto.randomUUID(), status: 'flagged', flags: ['podium-place'] }
  const legacy = {
    ...heldBefore,
    visitorHash: await hashToken('plays-legacy'),
    issuedAt: new Date(at(6)).toISOString(),
  }
  store.gameRuns.set(legacy.id, legacy)
  await play('plays-reporter', [12, null, null, null, null], {}, at(7))
  await service.reportEntry(game, await hashToken('plays-reporter'), first.entry.id, { target: 'name' }, at(7))
  const expected = [legacy.id, open.id, abandoned.id, refused.id, marked.run.id, weaker.run.id, first.run.id]

  const everything = await read()
  const all = everything.body.runs
  assert(
    everything.response.headers.get('Cache-Control') === 'no-store' &&
      everything.body.season === week &&
      everything.body.nextCursor === null &&
      all
        .slice(1)
        .map(({ id }) => id)
        .join() === expected.join(),
    'the list holds every run of the board, newest first by when it was issued',
  )
  assert(
    all
      .slice(1)
      .map(({ status, flags }) => `${status}:${flags.join('+')}`)
      .join() === 'flagged:podium-place,issued:,abandoned:,rejected:too-fast,scored:claimed-mismatch,scored:,scored:' &&
      all.map(({ best }) => best).join() === 'true,false,false,false,false,true,false,true',
    'each run says its status, its marks, and whether it is the record of its visitor',
  )
  const markedRow = all.find(({ id }) => id === marked.run.id)
  const record = everything.body.records.find(({ id }) => id === first.entry.id)
  assert(
    markedRow?.homeRuns === 3 &&
      markedRow.result?.pitches.some((pitch) => pitch.power !== null && pitch.power > 0) &&
      markedRow.visitor !== record?.visitor &&
      all.filter(({ visitor }) => visitor === record?.visitor).length === 2 &&
      !JSON.stringify(everything.body).includes(await hashToken('plays-reported')),
    "a run shows the power visitors never see, and a visitor's rows share a short key, never the whole hash",
  )
  assert(
    everything.body.records.length === 3 &&
      record?.name === 'Sprout' &&
      record.listed &&
      record.rank === 1 &&
      record.reports.map(({ target, count }) => `${target}:${count}`).join() === 'name:1' &&
      everything.body.records.find(({ id }) => id === marked.entry.id)?.listed === false,
    'the records of the visitors who played come with their name, listing, place, and open reports',
  )

  const pageOne = await read('&limit=3')
  const pageTwo = await read(`&limit=3&cursor=${pageOne.body.nextCursor}`)
  const pageThree = await read(`&limit=3&cursor=${pageTwo.body.nextCursor}`)
  const paged = [pageOne, pageTwo, pageThree].flatMap(({ body }) => body.runs.map(({ id }) => id))
  assert(
    paged.join() === all.map(({ id }) => id).join() &&
      pageOne.body.runs.length === 3 &&
      pageTwo.body.nextCursor !== null &&
      pageThree.body.nextCursor === null,
    'pages follow one another without a gap or a repeat, and the last says there is no more',
  )
  assert(
    pageOne.body.records.every(({ id }) => id !== first.entry.id) &&
      pageOne.body.reported.map(({ id }) => id).join() === first.entry.id &&
      pageTwo.body.reported.length === 0 &&
      pageThree.body.records.map(({ id }) => id).join() === first.entry.id,
    'a page carries only the records of its own visitors, and the first page names the reported record wherever its runs are',
  )
  const laterRun = await service.issueRun(game, await hashToken('plays-late'), at(8), seed)
  const afterLater = await read(`&limit=3&cursor=${pageOne.body.nextCursor}`)
  assert(
    afterLater.body.runs.map(({ id }) => id).join() === pageTwo.body.runs.map(({ id }) => id).join() &&
      (await read('&limit=1')).body.runs[0]?.id === laterRun.id,
    'a run that arrives while the admin pages does not shift the pages after it',
  )
  for (const query of [
    '&cursor=yesterday',
    `&cursor=${pageOne.body.nextCursor}x`,
    '&limit=0',
    '&limit=101',
    '&limit=ten',
  ]) {
    assert((await read(query)).response.status === 400, `the list refuses ${query}`)
  }

  const legacyVisitor = await hashToken('plays-legacy')
  const resent = await rejection(() =>
    service.submitRunResult(game, legacyVisitor, legacy.id, resultBody(fiveNormal, seed, [12]), true, at(6)),
  )
  assert(
    resent instanceof DomainError &&
      resent.code === 'CONFLICT' &&
      (await entryOf('plays-legacy', week)) === null &&
      (await store.hasJudgedRun(game, legacyVisitor)),
    'a run held under the old review stays as it was: never a record, not recordable again, and still a judged run',
  )
}

async function checkTakedownAndErasure(assert: Assert): Promise<void> {
  const { store, send, play, own, act, entryOf, podium, verifyLink, startSignIn, stand } = await reviewHarness()
  await stand('erase-four', [12, -21, null, 33, -27], 'Sprout')
  await stand('erase-three', [12, -21, null, 33, null], 'Pebble')
  await stand('erase-two', [12, null, null, 33, null], 'Clover')
  const one = await stand('erase-one', [12, null, null, null, null], 'Thistle')
  assert(
    (await own('erase-one', linkOfRequest('%EB%A9%94%EC%9D%B4%ED%94%8C-sample'))).status === 400,
    "a resident's link cannot be claimed by a record",
  )
  const filler = await own('erase-one', { listed: true, profile: { ...profile, name: 'ㅤ' } })
  const fillerBoard = (await (await send('GET', `/v1/games/${game}/leaderboard`)).json()) as { ranks: PublicEntry[] }
  assert(
    filler.status === 200 &&
      (await entryOf('erase-one'))?.nameStatus === 'rejected' &&
      fillerBoard.ranks[0]?.nameState === 'anonymous',
    'a name of only a Hangul filler is rejected: an anonymous batter that keeps its place',
  )

  await own('erase-three', linkOfRequest('pebble-sample'))
  await verifyLink('erase-three')
  const pebble = await entryOf('erase-three')
  const takedown = await act('erase-three', 'takedown', { blockLinkedIn: true })
  const answered = ((await takedown.json()) as { entry: ReviewedEntry }).entry
  const anonymous = (await podium())[1]
  assert(
    takedown.status === 200 &&
      answered.profile === null &&
      answered.name === null &&
      anonymous !== undefined &&
      anonymous.id === pebble?.id &&
      anonymous.name === null &&
      anonymous.nameState === 'anonymous' &&
      anonymous.profile.kind === 'default' &&
      anonymous.linkedInProfileUrl === undefined &&
      (await entryOf('erase-three'))?.linkedIn === null,
    'a takedown anonymises the record, statue included, keeps its score and place, and the admin reads no name or character of it',
  )
  const renamedTakedown = await own('erase-three', { listed: true, profile: { ...profile, name: 'Pebble' } })
  assert(
    renamedTakedown.status === 200 &&
      (await entryOf('erase-three'))?.authorName === null &&
      (await own('erase-three', linkOfRequest('pebble-other'))).status === 409,
    'a record taken down never shows a name or a link again',
  )
  assert(
    (await own('erase-two', linkOfRequest('pebble-sample'))).status === 400,
    'a link a takedown blocked cannot be linked by another record',
  )

  const pastTime = rankingWeekStart('2026-01-05') + 60 * minute
  await play('erase-two', [12, null, null, 33, null], { profile: { ...profile, name: 'Clover' } }, pastTime)
  await own('erase-two', linkOfRequest('clover-sample'))
  await startSignIn('erase-two')
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
      [...store.gameRuns.values()].every((run) => run.visitorHash !== twoHash) &&
      store.linkVerifications.size === 0,
    "a visitor's deletion removes their runs and records of the game in every season, and a sign-in started for them",
  )
  assert(
    (await podium()).map(({ id }) => id).join() === [statuesBefore[0], statuesBefore[1], one?.id].join(),
    "the next record takes a deleted statue's place at once",
  )
}

function linkOfRequest(id: string) {
  return { linkedIn: linkOf(id) }
}

/** Past seasons stay as they are, but a past statue's link stays only while its owner keeps it on. */
async function checkPastSeason(assert: Assert): Promise<void> {
  const { service, play, own, entryOf, board } = await reviewHarness()
  const pastWeek = '2026-02-16'
  const pastTime = rankingWeekStart(pastWeek) + 60 * minute
  const visitorHash = await hashToken('past-champion')
  const named = { ...profile, name: 'Sprout' }
  await play('past-champion', [12, -21, null, 33, -27], { profile: named }, pastTime)
  await service.updateOwnEntry(game, visitorHash, { listed: true, profile: named, ...linkRequest() }, null, pastTime)
  const started = await service.beginLinkVerification(linkedInOidc, game, visitorHash, pastWeek)
  const state = new URL(started.authorizationUrl).searchParams.get('state') ?? ''
  await service.completeLinkVerification(
    linkedInOidc,
    { transactionId: started.transactionId, state, code: 'code' },
    visitorHash,
  )
  assert(
    (await board(pastWeek)).podium[0]?.linkedInProfileUrl === 'https://www.linkedin.com/in/sprout-sample',
    "a past season's statue shows its link once its visitor signs in, even after the season ended",
  )
  assert(
    (await own('past-champion', { listed: false }, pastWeek)).status === 400,
    "a past season's record cannot be unlisted or renamed",
  )
  assert(
    (await own('past-champion', { linkedIn: null }, pastWeek)).status === 200 &&
      (await entryOf('past-champion', pastWeek))?.linkedIn === null &&
      (await board(pastWeek)).podium[0]?.linkedInProfileUrl === undefined,
    "turning a past statue's link off deletes it",
  )
  await own('past-champion', { anonymize: true }, pastWeek)
  const anonymized = (await board(pastWeek)).podium[0]
  assert(
    anonymized?.nameState === 'anonymous' && (await entryOf('past-champion', pastWeek))?.authorName === null,
    'a past record anonymised by its owner keeps its place without a name',
  )
}

/** A finished season keeps the first three of its public order, showing only what each owner still shows. */
async function checkHallOfFame(assert: Assert): Promise<void> {
  const { service, send, play, own, entryOf } = await reviewHarness()
  const pastWeek = '2026-01-05'
  const at = rankingWeekStart(pastWeek) + 60 * minute
  async function playAt(token: string, errorsMs: Array<number | null>, time = at) {
    await play(token, errorsMs, { profile: { ...profile, name: token } }, time)
  }
  async function stand(token: string, errorsMs: Array<number | null>) {
    await playAt(token, errorsMs)
    const listing = { listed: true, profile: { ...profile, name: token }, linkedIn: linkOf(`${token}-sample`) }
    await service.updateOwnEntry(game, await hashToken(token), listing, null, at)
  }
  async function adminAct(token: string, action: EntryReviewAction) {
    const entry = await entryOf(token, pastWeek)
    await service.reviewEntry(adminActor, game, entry?.id ?? '', action, { updatedAt: entry?.updatedAt })
  }
  async function signIn(token: string) {
    const visitorHash = await hashToken(token)
    const started = await service.beginLinkVerification(linkedInOidc, game, visitorHash, pastWeek)
    const state = new URL(started.authorizationUrl).searchParams.get('state') ?? ''
    const callback = { transactionId: started.transactionId, state, code: 'code' }
    await service.completeLinkVerification(linkedInOidc, callback, visitorHash)
  }
  async function hall(cookie = 'hall-nobody') {
    const response = await send('GET', `/v1/games/${game}/hall-of-fame`, { cookie: cookieOf(cookie) })
    const text = await response.text()
    const seasons = (JSON.parse(text) as { seasons: Array<{ id: string; champions: PublicEntry[] }> }).seasons
    return { response, text, seasons, champions: seasons.find(({ id }) => id === pastWeek)?.champions ?? [] }
  }

  await playAt('hall-unlisted', [12, -21, -8, 33, -27])
  await stand('hall-out', [12, -21, -8, 33, -27])
  await adminAct('hall-out', 'disqualification')
  await stand('hall-first', [12, -21, null, 33, -27])
  await stand('hall-second', [12, -21, null, 33, null])
  await stand('hall-third', [12, null, null, 33, null])
  await stand('hall-fourth', [12, null, null, null, null])
  await signIn('hall-first')
  await signIn('hall-second')
  await playAt('hall-later', [12, null, null, null, null], rankingWeekStart('2026-02-02') + 60 * minute)
  await play('hall-current', [12, -21, -8, 33, -27], { profile: { ...profile, name: 'hall-current' } })
  await own('hall-current', { listed: true, profile: { ...profile, name: 'hall-current' } })

  const before = await hall()
  const standing = await Promise.all(
    ['hall-first', 'hall-second', 'hall-third', 'hall-fourth'].map((token) => entryOf(token, pastWeek)),
  )
  assert(
    before.seasons.map(({ id }) => id).join() === `2026-02-02,${pastWeek}` && before.seasons[0]?.champions.length === 0,
    "finished seasons come newest first, this week's never, and one with no public record stands empty",
  )
  assert(
    before.champions.map(({ id, rank }) => `${id}:${rank}`).join() ===
      standing
        .slice(0, 3)
        .map((entry, index) => `${entry?.id}:${index + 1}`)
        .join(),
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
      before.champions[2]?.linkedInProfileUrl === undefined &&
      before.champions[1]?.name === 'hall-second',
    'a champion shows a name at once, and a link once its visitor signed in and not before',
  )

  await own('hall-first', { linkedIn: null }, pastWeek)
  assert(
    (await hall()).champions[0]?.linkedInProfileUrl === undefined,
    'a champion who turns their link off no longer shows it',
  )
  await own('hall-second', { anonymize: true }, pastWeek)
  const named = await own('hall-second', { listed: true, profile: { ...profile, name: 'hall-second' } }, pastWeek)
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

  await adminAct('hall-first', 'disqualification')
  assert(
    (await hall()).champions.map(({ id, rank }) => `${id}:${rank}`).join() ===
      standing
        .slice(1)
        .map((entry, index) => `${entry?.id}:${index + 1}`)
        .join(),
    "removing a finished season's champion moves the records below up at once, the fourth onto the third place",
  )
}

/** Forgetting the visitor ends this browser's hold on its records and leaves the records alone. */
async function checkVisitorForget(assert: Assert): Promise<void> {
  const { send, own, entryOf, board, stand } = await reviewHarness()
  const forgetPath = '/v1/visitor/forget'
  const record = await stand('forget-first', [12, -21, null, 33, -27], 'Sprout')
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
