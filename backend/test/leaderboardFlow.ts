import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { type DerbyInputLog, replayDerby } from '../src/derbyJudge/derbyScore.js'
import { contactSeconds } from '../src/derbyJudge/pitch.js'
import { createRunPlan, planRunPitch, type RunPlan } from '../src/derbyJudge/runPlan.js'
import {
  BackendService,
  createApi,
  derbyRunFlags,
  DomainError,
  hashToken,
  judgeDerbyRun,
  MemoryStore,
  nextRankingWeek,
  parseDerbySubmission,
  parseRunProfile,
  parseTownLayout,
  podiumPlaceFlag,
  rankingWeek,
  rankingWeekStart,
  type Actor,
  type BallparkRules,
  type RunOutcome,
} from '../src/index.js'
import { sampleTownLayout } from './townFlow.js'

export type Assert = (condition: unknown, message: string) => asserts condition

const origin = 'https://town.example'
export const adminActor: Actor = { kind: 'linked', userId: 'review-admin', role: 'admin' }
export const game = 'home-run-derby'
export const minute = 60_000
export const fiveNormal: BallparkRules = { pitchCount: 5, difficulty: 'normal' }
/** Practice whose valid swings put the offset at their median, 108.7 ms, and the peak speed above the floor. */
const practice = [
  { errorMs: 96.4, speed: 8.1 },
  { errorMs: 121, speed: 9 },
  { errorMs: 108.7, speed: 8.6 },
  { errorMs: 131.2, speed: 9.4 },
  { errorMs: 101.9, speed: 8.8 },
]
const practiceOffsetMs = 108.7
/** The seed of the runs the harness plays. */
const boardSeed = 404
/** The frontend sends its whole `PlayerProfile`; a fictional one. */
export const profile = {
  name: 'Sprout',
  genderIdentity: 'self-described',
  hair: 'curls',
  hat: 'beanie',
  eyes: 'happy',
  ears: 'pointed',
  nose: 'small',
  mouth: 'grin',
  mustache: 'none',
  top: 'sweater',
  bottom: 'relaxed trousers',
  shoes: 'boots',
  colors: { skin: '#e9ba99', hair: '#a75838', hat: '#638fab', top: '#ca7765', bottom: '#374b65', shoes: '#ece3cc' },
}

type Outcome = {
  result: { homeRuns: number; totalDistanceDm: number; pitches: Array<{ outcome: string; distanceDm: number | null }> }
  standing: { kind: string; rank?: number; wouldBeRank?: number; personalBest?: boolean }
  entry: { season: string; listed: boolean; name: string | null; homeRuns: number; totalDistanceDm: number } | null
}

/** A swing whose timing error, once practice's offset is taken off, is `errorMs` at pitch `index` of `plan`. */
function swingAt(plan: RunPlan, index: number, errorMs: number) {
  const contactMs = contactSeconds(planRunPitch(plan, index)) * 1000 + practiceOffsetMs + errorMs
  return { contactMs, startedMs: contactMs - 230, speed: 9 + (index % 3) * 0.4, heightError: 0.05 - index * 0.02 }
}

/** A result for the run `rules` and `seed` plan, swinging `errorsMs` off (null lets the pitch go by), claiming truly. */
export function resultBody(rules: BallparkRules, seed: number, errorsMs: Array<number | null>) {
  const plan = createRunPlan(rules, seed)
  const swings = errorsMs.map((errorMs, index) => (errorMs === null ? null : swingAt(plan, index, errorMs)))
  const log: DerbyInputLog = { side: 'right', practice, swings }
  const replay = replayDerby(plan, log)
  return {
    ...log,
    clientElapsedMs: 40_000,
    claimed: { homeRuns: replay.homeRuns, totalDistanceDm: replay.homeRunDistanceDecimetres },
    profile,
  }
}

type PublicEntry = {
  id: string
  rank: number
  name: string | null
  nameState: string
  profile: Record<string, unknown>
  homeRuns: number
  achievedOn: string
}
type Board = {
  season: { id: string; startsAt: string; endsAt: string; final: boolean }
  podium: PublicEntry[]
  ranks: PublicEntry[]
  own: { id: string; listed: boolean; rank: number | null; disqualified: boolean; awaitingApproval: boolean } | null
}

export async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  return action().then(
    () => null,
    (error: unknown) => error,
  )
}

/**
 * A store, its service and API, and the admin's ballpark settings stored as given (a save would settle the rules).
 * Requests look like the game page's own `fetch` unless `fetchSite` says otherwise (`null` sends neither header).
 */
export function leaderboardHarness() {
  const store = new MemoryStore()
  const service = new BackendService(store)
  const api = createApi({ service, authStore: store, allowedOrigins: new Set([origin]), frontendUrl: `${origin}/` })

  function send(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string; origin?: string | null; fetchSite?: string | null } = {},
  ): Promise<Response> {
    const headers = new Headers({ 'Content-Type': 'application/json', 'Sec-Fetch-Mode': 'cors' })
    if (options.origin !== null) headers.set('Origin', options.origin ?? origin)
    if (options.fetchSite !== null) headers.set('Sec-Fetch-Site', options.fetchSite ?? 'same-origin')
    if (options.fetchSite === null) headers.delete('Sec-Fetch-Mode')
    if (options.cookie) headers.set('Cookie', options.cookie)
    const body = options.body === undefined ? null : JSON.stringify(options.body)
    return api(new Request(`${origin}${path}`, { method, headers, body }))
  }

  async function setBallpark(ballpark: Record<string, unknown>, contactEmail: string | null = 'robin@example.com') {
    const layout = parseTownLayout({
      ...sampleTownLayout,
      owner: { ...sampleTownLayout.owner, contactEmail },
      venues: { ballpark },
    })
    await store.saveTown(layout, (await store.getTown())?.revision ?? 0)
  }

  /** Plays one run of `fiveNormal` and sends its result as the game page would, with whatever review that brings. */
  async function playUnreviewed(
    token: string,
    errorsMs: Array<number | null>,
    extra: object = {},
    now = Date.now(),
  ): Promise<RunOutcome> {
    const visitorHash = await hashToken(token)
    const run = await service.issueRun(game, visitorHash, now - 2 * minute, boardSeed)
    const body = { ...resultBody(fiveNormal, boardSeed, errorsMs), ...extra }
    return service.submitRunResult(game, visitorHash, run.id, body, true, now)
  }

  /**
   * `playUnreviewed`, and a run held for nothing but its place among the statues is accepted at once, as an admin who
   * found nothing wrong would: the outcome then carries the accepted run and the approved record.
   */
  async function play(
    token: string,
    errorsMs: Array<number | null>,
    extra: object = {},
    now = Date.now(),
  ): Promise<RunOutcome> {
    const outcome = await playUnreviewed(token, errorsMs, extra, now)
    if (outcome.run.flags.join() !== podiumPlaceFlag) return outcome
    const seen = { updatedAt: outcome.entry?.updatedAt ?? null }
    return { ...outcome, ...(await service.acceptHeldRun(adminActor, game, outcome.run.id, seen, now)) }
  }

  return { store, service, send, setBallpark, play, playUnreviewed }
}

/**
 * Three approved records at the top of a board, better than any run of `fiveNormal` the checks play, so those runs
 * place below the statues and score at once.
 */
export function standApprovedStatues(store: MemoryStore, season: string): void {
  const achievedAt = new Date(rankingWeekStart(season)).toISOString()
  for (const place of [1, 2, 3]) {
    const id = crypto.randomUUID()
    store.leaderboardEntries.set(id, {
      id,
      game,
      season,
      visitorHash: `house-statue-${place}`,
      bestRunId: null,
      score: 5,
      tiebreak: 9000 - place,
      result: { homeRuns: 5, totalDistanceDm: 9000 - place, pitches: [] },
      achievedAt,
      authorName: null,
      nameStatus: null,
      appearance: parseRunProfile(profile).appearance,
      appearancePublic: true,
      listed: true,
      reviewStatus: 'approved',
      linkedIn: null,
      takedown: false,
      createdAt: achievedAt,
      updatedAt: achievedAt,
    })
  }
}

/** Ranked runs: issued by the server, played on the client, and recorded once from the server's own judging. */
export async function checkLeaderboardFlow(assert: Assert): Promise<void> {
  const { store, service, send, setBallpark } = leaderboardHarness()
  const submit = (runId: string, body: unknown, cookie?: string) =>
    send('POST', `/v1/games/${game}/runs/${runId}/result`, cookie ? { body, cookie } : { body })
  // The runs here are about recording, not the statues, so they place fourth and score at once.
  standApprovedStatues(store, rankingWeek(Date.now()))

  assert((await send('POST', `/v1/games/${game}/runs`)).status === 503, 'a town never saved has no open ballpark')
  await setBallpark({ visible: false, rules: fiveNormal })
  assert((await send('POST', `/v1/games/${game}/runs`)).status === 503, 'a hidden ballpark issues no ranked runs')
  await setBallpark({ visible: true, rules: fiveNormal }, null)
  assert(
    (await send('POST', `/v1/games/${game}/runs`)).status === 503,
    'a town without a contact email for takedown requests ranks nothing',
  )
  await setBallpark({ visible: true, rules: fiveNormal })
  assert((await send('POST', '/v1/games/ballpark/runs')).status === 404, 'an unknown game is not found')
  assert(
    (await send('POST', `/v1/games/${game}/runs`, { origin: null })).status === 403,
    'a run is issued only to a page from an allowed origin',
  )

  const issued = await send('POST', `/v1/games/${game}/runs`)
  const cookie = issued.headers.get('Set-Cookie')?.split(';')[0] ?? ''
  const { run } = (await issued.json()) as { run: { id: string; season: string; rules: unknown; seed: number } }
  assert(
    issued.status === 201 && cookie.startsWith('__Host-tom_visitor=') && run.season === rankingWeek(Date.now()),
    'the first run gives the browser a visitor cookie and counts in this KST week',
  )
  assert(
    isDeepStrictEqual(run.rules, fiveNormal) && Number.isInteger(run.seed) && run.seed >= 0 && run.seed < 2 ** 32,
    "a run carries the town's rules for the week and a 32-bit unsigned seed",
  )
  const repeatedIssues = await Promise.all(
    Array.from({ length: 25 }, () => send('POST', `/v1/games/${game}/runs`, { cookie })),
  )
  assert(
    repeatedIssues.every((response) => response.status === 201),
    'a visitor may start as many runs as they like, one after another',
  )

  const lastRun = ((await repeatedIssues.at(-1)?.json()) as { run: { id: string; seed: number } }).run
  const tooFast = await submit(lastRun.id, resultBody(fiveNormal, lastRun.seed, [10, 10, 10, 10, 10]), cookie)
  assert(tooFast.status === 409, 'a result sooner than the pitches can be played is refused')
  const visitorHash = await hashToken(cookie.slice('__Host-tom_visitor='.length))
  const waitedOut = await rejection(() =>
    service.submitRunResult(
      game,
      visitorHash,
      lastRun.id,
      resultBody(fiveNormal, lastRun.seed, [10]),
      true,
      Date.now() + minute,
    ),
  )
  assert(
    waitedOut instanceof DomainError && waitedOut.code === 'CONFLICT',
    'a run refused as too fast is used up, so waiting and sending it again does not help',
  )

  const seed = 20_261_101
  const playedRun = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, seed)
  const clean = resultBody(fiveNormal, seed, [12, null, -18, 25, null])
  assert((await submit(playedRun.id, clean)).status === 404, 'a result without the visitor cookie finds no run')
  assert(
    (await submit(playedRun.id, clean, '__Host-tom_visitor=someone-else')).status === 404,
    "another visitor's cookie cannot record someone else's run",
  )
  const malformed: Array<[string, unknown]> = [
    ['a swing missing for one pitch', { ...clean, swings: clean.swings.slice(1) }],
    [
      'a contact moment past 5 s',
      { ...clean, swings: [{ ...clean.swings[0], contactMs: 5001 }, ...clean.swings.slice(1)] },
    ],
    [
      'a swing that starts after its contact',
      { ...clean, swings: [{ ...clean.swings[0], startedMs: 900_000 }, ...clean.swings.slice(1)] },
    ],
    ['a negative client time', { ...clean, clientElapsedMs: -1 }],
    ['an unknown batting side', { ...clean, side: 'switch' }],
    ['two valid practice swings', { ...clean, practice: [...practice.slice(0, 2), { errorMs: 900, speed: 9 }] }],
    ['a character without colors', { ...clean, profile: { ...profile, colors: undefined } }],
  ]
  for (const [label, body] of malformed) {
    assert((await submit(playedRun.id, body, cookie)).status === 400, `${label} is refused`)
  }
  const keypoints = [
    [0.41, 0.52],
    [0.44, 0.49],
  ]
  const recorded = await submit(
    playedRun.id,
    {
      ...clean,
      swings: clean.swings.map((swing) => swing && { ...swing, keypoints }),
      poses: [keypoints],
      rules: { pitchCount: 3, difficulty: 'easy' },
      seed: 1,
      score: 99,
    },
    cookie,
  )
  const outcome = (await recorded.json()) as Outcome
  assert(recorded.status === 200, 'after malformed results the run is still open for a correct one')
  const storedRun = store.gameRuns.get(playedRun.id)
  assert(
    storedRun?.status === 'scored' &&
      !/keypoints|poses/u.test(JSON.stringify(storedRun.inputLog)) &&
      Object.keys(storedRun.inputLog ?? {}).join() === 'side,practice,swings',
    'pose keypoints and other unknown fields are never stored with the run',
  )
  assert(
    outcome.result.pitches.length === fiveNormal.pitchCount && outcome.result.homeRuns === clean.claimed.homeRuns,
    "the run is judged by its own rules and seed, not the ones in the result's body",
  )
  assert(
    outcome.standing.kind === 'unlisted' &&
      outcome.standing.wouldBeRank === 4 &&
      outcome.standing.personalBest === true &&
      outcome.entry?.listed === false &&
      outcome.entry.name === null,
    'a first record is kept off the board, without a name, until the visitor lists it',
  )
  const resent = await submit(playedRun.id, resultBody(fiveNormal, seed, [0, 0, 0, 0, 0]), cookie)
  assert(
    resent.status === 200 && isDeepStrictEqual(((await resent.json()) as Outcome).result, outcome.result),
    'a result sent again gets the first answer, whatever the second body says',
  )

  const heldRun = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, seed)
  const strongerClean = resultBody(fiveNormal, seed, [12, -9, -18, 25, 7])
  const held = (await (
    await submit(heldRun.id, { ...strongerClean, claimed: { homeRuns: 0, totalDistanceDm: 0 } }, cookie)
  ).json()) as Outcome
  assert(
    held.standing.kind === 'reviewing' &&
      held.result.homeRuns === strongerClean.claimed.homeRuns &&
      held.entry?.homeRuns === outcome.entry?.homeRuns &&
      store.gameRuns.get(heldRun.id)?.flags.includes('claimed-mismatch'),
    "a run whose claimed totals differ from the server's is held, and leaves the record as it was",
  )

  const abandoned = await service.issueRun(game, visitorHash, Date.now() - 3 * minute, seed)
  const current = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, seed)
  assert((await submit(abandoned.id, clean, cookie)).status === 409, 'starting a new run abandons the open one')
  const equal = await submit(current.id, clean, cookie)
  assert(equal.status === 200, 'the newest run is the one recorded')
  assert(
    ((await equal.json()) as Outcome).standing.personalBest === false &&
      [...store.leaderboardEntries.values()].some((entry) => entry.bestRunId === playedRun.id),
    'a run only as good as the record leaves the earlier record standing',
  )
  const expired = await service.issueRun(game, visitorHash, Date.now() - 11 * minute, seed)
  assert((await submit(expired.id, clean, cookie)).status === 409, 'a run past its ten minutes is not recorded')

  const hiddenLater = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, seed)
  await setBallpark({ visible: false, rules: fiveNormal })
  assert((await submit(hiddenLater.id, clean, cookie)).status === 503, 'a hidden ballpark records no runs')
  await setBallpark({ visible: true, rules: fiveNormal })
  assert(
    (await submit(hiddenLater.id, clean, cookie)).status === 200,
    'a run refused while the ballpark was hidden stays open until it is shown again',
  )
  const oversized = await submit(hiddenLater.id, { ...clean, padding: 'x'.repeat(9 * 1024) }, cookie)
  assert(oversized.status === 413, 'a result body over 8 KB is refused before it is read, nginx or not')

  await checkGoldenRun(assert, service, setBallpark, visitorHash)
  await checkWeekBoundary(assert)
  checkReviewFlags(assert)
  await checkRequestEvidence(assert)
  await checkBoard(assert)
  await checkStatueApproval(assert)
}

/**
 * The board: listed records in public order, the first three standing as statues, names shown once approved, and
 * nothing that identifies a visitor. A held run never stands, and a disqualified statue makes way for the next record.
 */
async function checkBoard(assert: Assert): Promise<void> {
  const { store, send, setBallpark, play } = leaderboardHarness()
  await setBallpark({ visible: true, rules: fiveNormal })
  const cookieOf = (token: string) => `__Host-tom_visitor=${token}`
  async function read(path: string, cookie?: string) {
    const response = await send('GET', `/v1/games/${game}/${path}`, cookie ? { cookie } : {})
    return { response, text: await response.clone().text(), body: (await response.json()) as Board }
  }
  const list = (token: string, body: unknown) =>
    send('PUT', `/v1/games/${game}/entries/own`, { body, cookie: cookieOf(token) })

  const players: Array<[string, Array<number | null>, string | null]> = [
    ['board-four', [12, -21, null, 33, -27], 'Sprout'],
    ['board-three', [12, -21, null, 33, null], 'Pebble'],
    ['board-two', [12, null, null, 33, null], null],
    ['board-one', [12, null, null, null, null], 'Clover'],
  ]
  for (const [token, errorsMs] of players) await play(token, errorsMs)
  const unlisted = await read('leaderboard', cookieOf('board-four'))
  assert(
    unlisted.body.podium.length === 0 && unlisted.body.own?.listed === false && unlisted.body.own.rank === 1,
    'records stay off the board until listed, and their owner is told the place they would take',
  )
  assert(
    (await list('board-four', { listed: true })).status === 400 &&
      (await send('PUT', `/v1/games/${game}/entries/own`, { body: { listed: false } })).status === 404 &&
      (await list('board-nobody', { listed: false })).status === 404,
    'listing needs the profile, and a browser lists only a record of its own',
  )
  for (const [token, , name] of players) await list(token, { listed: true, profile: { ...profile, name } })

  const board = await read('leaderboard')
  const order = [...board.body.podium, ...board.body.ranks]
  const ids = await Promise.all(
    players.map(
      async ([token]) =>
        (await store.getBoardEntryByVisitor({ game, season: board.body.season.id }, await hashToken(token)))?.id,
    ),
  )
  assert(
    isDeepStrictEqual(
      order.map(({ id }) => id),
      ids,
    ) &&
      board.body.podium.length === 3 &&
      isDeepStrictEqual(
        order.map(({ rank, homeRuns }) => [rank, homeRuns]),
        [
          [1, 4],
          [2, 3],
          [3, 2],
          [4, 1],
        ],
      ),
    'listed records rank by home runs, and the first three are the statues',
  )
  const hashes = await Promise.all(players.map(([token]) => hashToken(token)))
  assert(
    board.response.headers.get('Cache-Control') === 'no-store' &&
      board.body.own === null &&
      !hashes.some((hash) => board.text.includes(hash)) &&
      !/visitorHash|achievedAt|reviewStatus/u.test(board.text) &&
      order.every(({ achievedOn }) => /^\d{4}-\d{2}-\d{2}$/u.test(achievedOn)),
    'the public board carries no visitor hash, review state, or exact time, only the KST day',
  )
  assert(
    order.every(({ name }) => name === null) &&
      order[0]?.nameState === 'reviewing' &&
      order[2]?.nameState === 'anonymous' &&
      isDeepStrictEqual(order[2].profile, { kind: 'default' }) &&
      order[0].profile.hat === profile.hat,
    'a name stays hidden until it is approved, and a record without one shows the default batter',
  )
  const leader = await store.getBoardEntryByVisitor({ game, season: board.body.season.id }, hashes[0] ?? '')
  assert(leader, "the leader's record is stored")
  await store.updateEntry(leader.id, leader.updatedAt, { ...leader, nameStatus: 'approved' })
  assert((await read('leaderboard')).body.podium[0]?.name === 'Sprout', 'an approved name shows on its statue')

  const heldStrong = await play('board-held', [12, -21, null, 33, -27], {
    claimed: { homeRuns: 0, totalDistanceDm: 0 },
  })
  const heldBetter = await play('board-two', [12, -21, null, 33, -27], { claimed: { homeRuns: 0, totalDistanceDm: 0 } })
  const afterHeld = await read('podium')
  assert(
    heldStrong.standing.kind === 'reviewing' &&
      heldBetter.standing.kind === 'reviewing' &&
      isDeepStrictEqual(
        afterHeld.body.podium.map(({ id }) => id),
        ids.slice(0, 3),
      ),
    'held runs, however strong, never change the statues',
  )
  const statueStore = await store.getBoardEntryByVisitor({ game, season: board.body.season.id }, hashes[0] ?? '')
  assert(statueStore, 'the first statue is stored')
  await store.updateEntry(statueStore.id, statueStore.updatedAt, { ...statueStore, reviewStatus: 'disqualified' })
  const podium = await read('podium')
  const podiumWithCookie = await read('podium', cookieOf('board-three'))
  assert(
    isDeepStrictEqual(
      podium.body.podium.map(({ id }) => id),
      ids.slice(1),
    ) &&
      isDeepStrictEqual(
        podium.body.podium.map(({ rank }) => rank),
        [1, 2, 3],
      ),
    'disqualifying a statue makes the fourth record a statue',
  )
  assert(
    podium.response.headers.get('Cache-Control') === 'public, max-age=60' &&
      podium.response.headers.get('Set-Cookie') === null &&
      podium.text === podiumWithCookie.text &&
      podium.body.season.id === board.body.season.id &&
      !hashes.some((hash) => podium.text.includes(hash)),
    'the podium is the same for everyone, sets no cookie, and may be cached for a minute',
  )
  const disqualified = await read('leaderboard', cookieOf('board-four'))
  const disqualifiedBetter = await play('board-four', [12, -21, -8, 33, -27])
  assert(
    disqualified.body.own?.disqualified === true &&
      disqualified.body.own.rank === null &&
      disqualifiedBetter.standing.kind === 'excluded' &&
      (await read('podium')).text === podium.text,
    'a disqualified record stays off the board, even after a better run',
  )

  const thisWeek = board.body.season.id
  const nextWeek = nextRankingWeek(thisWeek)
  for (const season of ['2026-01', '2026-01-06', '2026-02-30']) {
    assert(
      (await read(`leaderboard?season=${season}`)).response.status === 400,
      `the season ${season} is refused: a season is the YYYY-MM-DD of a Monday`,
    )
  }
  assert((await read(`leaderboard?season=${nextWeek}`)).response.status === 404, 'a season still to come has no board')
  const pastWeek = await read('leaderboard?season=2025-12-29')
  assert(
    pastWeek.response.status === 200 &&
      pastWeek.body.season.final &&
      pastWeek.body.podium.length === 0 &&
      pastWeek.body.season.startsAt === '2025-12-28T15:00:00.000Z' &&
      pastWeek.body.season.endsAt === '2026-01-04T15:00:00.000Z',
    'a past season is still served, final, and bounded by Monday midnight KST, across a new year too',
  )

  const nextWeekAt = rankingWeekStart(nextWeek) + 5 * minute
  // Below three statues the runs score at once, so what is checked is the listing a new week's record starts with.
  standApprovedStatues(store, nextWeek)
  const returning = await play(
    'board-three',
    [12, null, null, null, null],
    { profile: { ...profile, name: 'Pebble' } },
    nextWeekAt,
  )
  assert(
    returning.standing.kind === 'ranked' &&
      returning.entry?.listed &&
      returning.entry.season === nextWeek &&
      returning.entry.authorName === 'Pebble',
    "a visitor's first record of a new week stays listed like their last one, under the same name",
  )
  const someoneElse = await play(
    'board-one',
    [12, null, null, null, null],
    { profile: { ...profile, name: 'Clover', hat: 'cap' } },
    nextWeekAt,
  )
  assert(
    someoneElse.standing.kind === 'consentNeeded' &&
      someoneElse.entry?.listed === false &&
      someoneElse.entry.authorName === null,
    "a first record that looks like someone else's waits for its own consent",
  )
  const renamed = await play(
    'board-three',
    [12, null, null, null, null],
    { profile: { ...profile, name: 'Pebble Two' } },
    nextWeekAt + minute,
  )
  assert(
    renamed.standing.kind === 'consentNeeded' && renamed.entry?.listed === false && renamed.entry.authorName === null,
    'a run under another name takes a listed record off the board with its name',
  )
}

/** Each review check holds a run that trips it and leaves an ordinary run alone. */
function checkReviewFlags(assert: Assert): void {
  const seed = 31
  const clean = parseDerbySubmission(resultBody(fiveNormal, seed, [12, -21, null, 33, -27]), fiveNormal)
  const flagsOf = (submission: typeof clean) =>
    derbyRunFlags({
      rules: fiveNormal,
      log: submission.log,
      record: judgeDerbyRun(fiveNormal, seed, submission, 60_000),
    })
  assert(flagsOf(clean).length === 0, 'an ordinary run is not held')
  const plan = createRunPlan(fiveNormal, seed)
  const withSwings = (
    errorsMs: Array<number | null>,
    change: (swing: ReturnType<typeof swingAt>) => object = (swing) => swing,
  ) => ({
    ...clean,
    log: {
      ...clean.log,
      swings: errorsMs.map((errorMs, index) =>
        errorMs === null ? null : { ...swingAt(plan, index, errorMs), ...change(swingAt(plan, index, errorMs)) },
      ),
    },
  })
  const withPractice = (change: (sample: { errorMs: number; speed: number }) => object) => ({
    ...clean,
    log: { ...clean.log, practice: clean.log.practice.map((sample) => ({ ...sample, ...change(sample) })) },
  })
  const cases: Array<[string, typeof clean]> = [
    [
      'claimed-mismatch',
      { ...clean, claimed: { ...clean.claimed, totalDistanceDm: clean.claimed.totalDistanceDm + 1 } },
    ],
    ['timing-too-precise', withSwings([1, -2, null, 3, -4])],
    ['machine-values', withSwings([20, 20, null, 20, -14])],
    ['calibration-offset', withPractice((sample) => ({ errorMs: sample.errorMs - 90 }))],
    ['peak-at-floor', withPractice(() => ({ speed: 3 }))],
    ['speed-outside-practice', withSwings([12, -21, null, 33, -27], (swing) => ({ speed: swing.speed * 1.6 }))],
    ['height-missing', withSwings([12, -21, null, 33, -27], () => ({ heightError: null }))],
    ['swing-duration', withSwings([12, -21, null, 33, -27], (swing) => ({ startedMs: swing.contactMs - 30 }))],
    ['swing-speed', withSwings([12, -21, null, 33, -27], () => ({ speed: 41 }))],
    ['steady-power', withSwings([12, -21, null, 33, -27], () => ({ speed: 9 }))],
    ['near-maximum', withSwings([0, 0, 0, 0, 0], () => ({ speed: 11, heightError: 0 }))],
    ['clock-skew', { ...clean, clientElapsedMs: 62_001 }],
  ]
  for (const [flag, submission] of cases) {
    assert(flagsOf(submission).includes(flag), `${flag} holds the run that trips it`)
  }
}

/** The server's score is the frontend judge's for the same run, whatever totals the client claims. */
async function checkGoldenRun(
  assert: Assert,
  service: BackendService,
  setBallpark: (ballpark: Record<string, unknown>) => Promise<void>,
  visitorHash: string,
): Promise<void> {
  const vectorsFile = new URL('../../test/derbyJudgeVectors.json', import.meta.url)
  const { vectors } = JSON.parse(await readFile(vectorsFile, 'utf8')) as {
    vectors: Array<{
      name: string
      rules: BallparkRules
      seed: number
      log: DerbyInputLog
      expected: { homeRuns: number; homeRunDistanceDecimetres: number; pitches: Array<Record<string, unknown>> }
    }>
  }
  const vector = vectors.find(({ name }) => name.includes('left-handed'))
  assert(vector, 'the golden vectors include a left-handed run')
  await setBallpark({ visible: true, rules: vector.rules })
  const run = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, vector.seed)
  const body = {
    ...vector.log,
    clientElapsedMs: 60_000,
    claimed: { homeRuns: vector.rules.pitchCount, totalDistanceDm: 0 },
    profile,
  }
  const outcome = await service.submitRunResult(game, visitorHash, run.id, body, true)
  const scored = outcome.run.result?.pitches.map(({ pitchType, outcome: result, distanceDecimetres }) => ({
    pitchType,
    outcome: result,
    distanceDecimetres,
  }))
  const expected = vector.expected.pitches.map(({ pitchType, outcome: result, distanceDecimetres }) => ({
    pitchType,
    outcome: result,
    distanceDecimetres,
  }))
  assert(
    isDeepStrictEqual(scored, expected) &&
      outcome.run.score === vector.expected.homeRuns &&
      outcome.run.tiebreak === vector.expected.homeRunDistanceDecimetres,
    `${vector.name}: the recorded score is the golden vector's, not the claimed totals`,
  )
  assert(
    outcome.standing.kind === 'reviewing' && outcome.run.flags.includes('claimed-mismatch'),
    'claimed totals the server does not reach hold the run',
  )
}

/**
 * A run belongs to the KST week it was issued in: issued just before Monday midnight it keeps that week's rules and
 * board when its result arrives after; issued at midnight it gets the rules scheduled for the new week. A place among
 * the statues waits for the admin on a board that has ended like on any other.
 */
async function checkWeekBoundary(assert: Assert): Promise<void> {
  const { service, setBallpark, play } = leaderboardHarness()
  const sevenHard: BallparkRules = { pitchCount: 7, difficulty: 'hard' }
  const endingWeek = '2026-10-26'
  const newWeek = '2026-11-02'
  await setBallpark({ visible: true, rules: fiveNormal, scheduledRules: { fromWeek: newWeek, rules: sevenHard } })
  const visitorHash = await hashToken('week-boundary-visitor')
  // Monday 2026-11-02 00:00 in Seoul.
  const midnight = Date.parse('2026-11-01T15:00:00.000Z')
  const earlierHash = await hashToken('week-boundary-earlier')
  await play('week-boundary-earlier', [12, null, -15, 30, null], {}, midnight - minute)
  const late = await service.issueRun(game, visitorHash, midnight - 1, 77)
  assert(
    late.season === endingWeek && isDeepStrictEqual(late.rules, fiveNormal),
    "a run issued in the last millisecond of Sunday KST takes that week's rules, not the next week's",
  )
  const lateOutcome = await service.submitRunResult(
    game,
    visitorHash,
    late.id,
    { ...resultBody(fiveNormal, 77, [12, null, -15, 30, null]), clientElapsedMs: 29_000 },
    true,
    midnight + minute,
  )
  assert(
    lateOutcome.run.season === endingWeek &&
      lateOutcome.run.flags.join() === podiumPlaceFlag &&
      lateOutcome.standing.kind === 'reviewing' &&
      lateOutcome.entry === null,
    "a result arriving after midnight counts in the week the run was issued in, and waits for its statue's approval there",
  )
  const accepted = await service.acceptHeldRun(adminActor, game, late.id, { updatedAt: null }, midnight + 2 * minute)
  const listing = { listed: true, profile }
  const listedLate = await service.updateOwnEntry(game, visitorHash, listing, endingWeek, midnight + 3 * minute)
  const finalRecord = await rejection(() =>
    service.updateOwnEntry(game, earlierHash, listing, endingWeek, midnight + 3 * minute),
  )
  assert(
    accepted.entry.season === endingWeek &&
      listedLate.entry.listed &&
      finalRecord instanceof DomainError &&
      finalRecord.code === 'INVALID_INPUT',
    "a record whose run was accepted after midnight may still be listed on its week's board, unlike one there before",
  )
  const early = await service.issueRun(game, visitorHash, midnight, 77)
  assert(
    early.season === newWeek && isDeepStrictEqual(early.rules, sevenHard),
    'a run issued at Monday midnight KST takes the rules scheduled for the new week',
  )
}

/**
 * A result whose request does not look like the game page's own fetch is held with a flag, and nothing else of the
 * request is kept.
 */
async function checkRequestEvidence(assert: Assert): Promise<void> {
  const { store, service, send, setBallpark } = leaderboardHarness()
  await setBallpark({ visible: true, rules: fiveNormal })
  standApprovedStatues(store, rankingWeek(Date.now()))
  const cookie = '__Host-tom_visitor=evidence-visitor'
  const visitorHash = await hashToken('evidence-visitor')
  async function flagsSentAs(fetchSite: string | null): Promise<string[]> {
    const run = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, 404)
    const body = resultBody(fiveNormal, 404, [12, null, null, null, null])
    const response = await send('POST', `/v1/games/${game}/runs/${run.id}/result`, { body, cookie, fetchSite })
    assert(response.status === 200, 'the result is recorded however it was sent')
    return store.gameRuns.get(run.id)?.flags ?? []
  }
  assert(
    (await flagsSentAs('same-origin')).length === 0,
    "a result sent by the game page's own fetch is not held for where it came from",
  )
  assert(
    (await flagsSentAs(null)).join() === 'not-from-browser' &&
      (await flagsSentAs('cross-site')).join() === 'not-from-browser' &&
      (await flagsSentAs('none')).join() === 'not-from-browser',
    'a result without the headers of a same-origin fetch, as a script sends it, is held with a flag',
  )
  assert(
    !/sec-fetch|cross-site/iu.test(JSON.stringify([...store.gameRuns.values()])),
    'only the flag is stored, never what the request said of itself',
  )
}

/**
 * A place among the statues is published only once the admin approved its record, whichever way the record got there:
 * at once, listed later, or moved up when a record above it went. Fourth place and below show at once.
 */
async function checkStatueApproval(assert: Assert): Promise<void> {
  const { store, service, send, setBallpark, play, playUnreviewed } = leaderboardHarness()
  await setBallpark({ visible: true, rules: fiveNormal })
  const season = rankingWeek(Date.now())
  const cookieOf = (token: string) => `__Host-tom_visitor=${token}`
  const listing = (name: string) => ({ listed: true, profile: { ...profile, name } })
  const list = (token: string) =>
    send('PUT', `/v1/games/${game}/entries/own`, { body: listing(token), cookie: cookieOf(token) })
  const entryOf = async (token: string) => store.getBoardEntryByVisitor({ game, season }, await hashToken(token))
  async function shown(token = 'approval-nobody') {
    const response = await send('GET', `/v1/games/${game}/leaderboard`, { cookie: cookieOf(token) })
    const board = (await response.json()) as Board
    const podium = ((await (await send('GET', `/v1/games/${game}/podium`)).json()) as Board).podium
    const places = (entries: PublicEntry[]) => entries.map(({ rank, homeRuns }) => `${rank}:${homeRuns}`).join()
    return { own: board.own, board: places([...board.podium, ...board.ranks]), podium: places(podium) }
  }
  const approve = async (token: string) => {
    const entry = await entryOf(token)
    return service.reviewEntry(adminActor, game, entry?.id ?? '', 'approval', { updatedAt: entry?.updatedAt })
  }
  const queueKinds = async () =>
    (await service.getReviewQueue(adminActor, game, null)).map(({ kind, entry }) => `${kind}:${entry?.homeRuns ?? '-'}`)

  const first = await playUnreviewed('approval-first', [12, -21, null, 33, null])
  assert(
    first.run.status === 'flagged' &&
      first.run.flags.join() === podiumPlaceFlag &&
      first.standing.kind === 'reviewing' &&
      first.entry === null &&
      (await list('approval-first')).status === 404,
    'a clean run that would stand among the statues is held, makes no record, and so cannot be listed around the admin',
  )
  assert(
    (await shown()).board === '' && (await queueKinds()).join() === 'statue-run:-',
    'nothing of it is public, and it leads the review queue',
  )
  await service.acceptHeldRun(adminActor, game, first.run.id, { updatedAt: null })
  assert((await shown()).podium === '', 'an accepted record its visitor has not listed is still not public')
  await list('approval-first')
  assert((await shown()).podium === '1:3', 'once accepted, listing it publishes the statue at once')
  const repeated = await playUnreviewed('approval-first', [12, -21, null, 33, null], listing('approval-first'))
  assert(
    repeated.run.status === 'scored' && repeated.standing.kind === 'ranked' && repeated.standing.rank === 1,
    'a run no better than the approved statue changes nothing, so it is not held',
  )

  for (const token of ['approval-second', 'approval-third']) {
    await play(token, [12, null, null, 33, null])
    await list(token)
  }
  // Equal runs rank by when they arrived, so each of these arrives a second after the one before.
  const startedAt = Date.now()
  const fourth = await playUnreviewed('approval-fourth', [12, null, null, null, null], {}, startedAt + 1000)
  await list('approval-fourth')
  await playUnreviewed('approval-fifth', [12, null, null, null, null], {}, startedAt + 2000)
  await list('approval-fifth')
  assert(
    fourth.run.status === 'scored' && fourth.standing.kind === 'unlisted' && fourth.standing.wouldBeRank === 4,
    'a run that would place fourth scores at once, with no review',
  )
  assert((await shown()).board === '1:3,2:2,3:2,4:1,5:1', 'fourth place and below are public without approval')

  const improved = await playUnreviewed('approval-first', [12, -21, null, 33, -27], listing('approval-first'))
  assert(
    improved.standing.kind === 'reviewing' && improved.entry?.score === 3 && (await shown()).podium === '1:3,2:2,3:2',
    'a statue that improves waits for approval again, and its approved record stands meanwhile',
  )
  await service.acceptHeldRun(adminActor, game, improved.run.id, { updatedAt: improved.entry?.updatedAt ?? null })
  assert((await shown()).podium === '1:4,2:2,3:2', 'accepting the better run publishes it at once')

  const second = await entryOf('approval-second')
  await service.reviewEntry(adminActor, game, second?.id ?? '', 'disqualification', { updatedAt: second?.updatedAt })
  const promoted = await shown('approval-fourth')
  assert(
    promoted.board === '1:4,2:2,4:1' && promoted.podium === '1:4,2:2',
    'a record that moves up to third when a statue goes is not shown there unapproved, and the fifth takes no statue',
  )
  assert(
    promoted.own?.rank === 3 &&
      promoted.own.awaitingApproval &&
      (await shown('approval-fifth')).own?.awaitingApproval === false,
    'its visitor is told the place and that it waits for approval',
  )
  const later = await playUnreviewed(
    'approval-fourth',
    [12, null, null, null, null],
    listing('approval-fourth'),
    startedAt + 3000,
  )
  assert(
    later.run.status === 'scored' && later.standing.kind === 'reviewing' && (await queueKinds()).includes('statue:1'),
    'a later run of theirs is answered as under review, and the waiting statue leads the queue',
  )
  await approve('approval-fourth')
  assert((await shown()).podium === '1:4,2:2,3:1', 'approving the record publishes its statue at once')

  await play('approval-unlisted', [12, null, null, null, null], {}, startedAt + 4000)
  await service.deleteOwnRecords(game, await hashToken('approval-third'))
  await service.deleteOwnRecords(game, await hashToken('approval-fifth'))
  const unlisted = await shown('approval-unlisted')
  assert(
    unlisted.own?.listed === false && unlisted.own.rank === 3 && unlisted.own.awaitingApproval,
    'an unlisted record that would now stand third is told so before it is listed',
  )
  await list('approval-unlisted')
  assert(
    (await shown()).board === '1:4,2:1',
    'listing a record that has moved up among the statues does not publish it before the admin approves it',
  )
  await approve('approval-unlisted')
  assert((await shown()).board === '1:4,2:1,3:1', 'and approval then does')
}
