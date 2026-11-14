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
  parseTownLayout,
  rankingWeek,
  rankingWeekStart,
  type Actor,
  type BallparkRules,
  type LinkedInOidcAdapter,
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
  own: { id: string; listed: boolean; rank: number | null; disqualified: boolean } | null
  linkedInAvailable: boolean
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
 * LinkedIn sign-in is configured only when `linkedInOidc` is given.
 */
export function leaderboardHarness(linkedInOidc?: LinkedInOidcAdapter) {
  const store = new MemoryStore()
  const service = new BackendService(store)
  const warnings: string[] = []
  const api = createApi({
    service,
    authStore: store,
    ...(linkedInOidc ? { linkedInOidc } : {}),
    allowedOrigins: new Set([origin]),
    frontendUrl: `${origin}/admin`,
    logger: { warn: (message: string) => void warnings.push(message), error: console.error },
  })

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

  /** Plays one run of `fiveNormal`, issued two minutes before `now`, and sends its result as the game page would. */
  async function play(
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

  return { store, service, send, setBallpark, play, warnings }
}

/** Ranked runs: issued by the server, played on the client, and recorded once from the server's own judging. */
export async function checkLeaderboardFlow(assert: Assert): Promise<void> {
  const { store, service, send, setBallpark } = leaderboardHarness()
  const submit = (runId: string, body: unknown, cookie?: string) =>
    send('POST', `/v1/games/${game}/runs/${runId}/result`, cookie ? { body, cookie } : { body })
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
      outcome.standing.wouldBeRank === 1 &&
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

  const markedRun = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, seed)
  const strongerClean = resultBody(fiveNormal, seed, [12, -9, -18, 25, 7])
  const marked = (await (
    await submit(markedRun.id, { ...strongerClean, claimed: { homeRuns: 0, totalDistanceDm: 0 } }, cookie)
  ).json()) as Outcome
  assert(
    marked.standing.kind === 'unlisted' &&
      marked.standing.personalBest === true &&
      marked.entry?.homeRuns === strongerClean.claimed.homeRuns &&
      marked.entry.homeRuns > (outcome.entry?.homeRuns ?? 0) &&
      store.gameRuns.get(markedRun.id)?.status === 'scored' &&
      store.gameRuns.get(markedRun.id)?.flags.includes('claimed-mismatch'),
    "a run whose claimed totals differ from the server's is scored and becomes the record at once, with the mark kept",
  )

  const abandoned = await service.issueRun(game, visitorHash, Date.now() - 3 * minute, seed)
  const current = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, seed)
  assert((await submit(abandoned.id, clean, cookie)).status === 409, 'starting a new run abandons the open one')
  const equal = await submit(current.id, strongerClean, cookie)
  assert(equal.status === 200, 'the newest run is the one recorded')
  assert(
    ((await equal.json()) as Outcome).standing.personalBest === false &&
      [...store.leaderboardEntries.values()].some((entry) => entry.bestRunId === markedRun.id),
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
}

/**
 * The board: listed records in public order, the first three standing as statues with their names, at once and with
 * nothing that identifies a visitor. A marked run stands like any other, and the admin's removal takes a statue down.
 */
async function checkBoard(assert: Assert): Promise<void> {
  const { store, service, send, setBallpark, play } = leaderboardHarness()
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
  const season = board.body.season.id
  const entryOf = async (token: string) => store.getBoardEntryByVisitor({ game, season }, await hashToken(token))
  const ids = await Promise.all(players.map(async ([token]) => (await entryOf(token))?.id))
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
    'listed records rank by home runs, and the first three stand as statues at once, with no approval',
  )
  const hashes = await Promise.all(players.map(([token]) => hashToken(token)))
  assert(
    board.response.headers.get('Cache-Control') === 'no-store' &&
      board.body.own === null &&
      !board.body.linkedInAvailable &&
      !hashes.some((hash) => board.text.includes(hash)) &&
      !/visitorHash|achievedAt|disqualified|flags/u.test(board.text) &&
      order.every(({ achievedOn }) => /^\d{4}-\d{2}-\d{2}$/u.test(achievedOn)),
    'the public board carries no visitor hash, admin state, or exact time, only the KST day',
  )
  assert(
    order.map(({ name, nameState }) => `${name}:${nameState}`).join() ===
      'Sprout:shown,Pebble:shown,null:anonymous,Clover:shown' &&
      isDeepStrictEqual(order[2]?.profile, { kind: 'default' }) &&
      order[0]?.profile.hat === profile.hat,
    'a listed name shows at once, and a record without one shows the default batter',
  )

  const marked = await play('board-two', [12, -21, null, 33, -27], { claimed: { homeRuns: 0, totalDistanceDm: 0 } })
  const afterMarked = await read('podium')
  assert(
    marked.run.flags.join() === 'claimed-mismatch' &&
      marked.standing.kind === 'ranked' &&
      marked.standing.rank === 2 &&
      isDeepStrictEqual(
        afterMarked.body.podium.map(({ id }) => id),
        [ids[0], ids[2], ids[1]],
      ),
    'a marked run that reaches the statues stands there at once, behind the earlier record it equals',
  )
  assert(
    afterMarked.response.headers.get('Cache-Control') === 'public, max-age=60' &&
      afterMarked.response.headers.get('Set-Cookie') === null &&
      afterMarked.text === (await read('podium', cookieOf('board-three'))).text &&
      afterMarked.body.season.id === season &&
      !hashes.some((hash) => afterMarked.text.includes(hash)),
    'the podium is the same for everyone, sets no cookie, and may be cached for a minute',
  )

  const act = async (token: string, action: 'disqualification' | 'restoration') => {
    const entry = await entryOf(token)
    return service.reviewEntry(adminActor, game, entry?.id ?? '', action, { updatedAt: entry?.updatedAt })
  }
  await act('board-two', 'disqualification')
  const removed = await read('podium')
  assert(
    isDeepStrictEqual(
      removed.body.podium.map(({ id, rank }) => [id, rank]),
      [
        [ids[0], 1],
        [ids[1], 2],
        [ids[3], 3],
      ],
    ),
    "the admin's removal takes a statue down at once, and the next record takes its place",
  )
  const removedOwn = await read('leaderboard', cookieOf('board-two'))
  const replay = await play('board-two', [12, -21, -8, 33, -27])
  assert(
    removedOwn.body.own?.disqualified === true &&
      removedOwn.body.own.rank === null &&
      replay.standing.kind === 'excluded' &&
      (await read('podium')).text === removed.text,
    "a removed visitor's better run that week does not put them back on the board",
  )
  await act('board-two', 'restoration')
  assert(
    (await read('podium')).body.podium[0]?.id === ids[2],
    'undoing the removal puts the record back at once, with the best run it has',
  )

  const nextWeek = nextRankingWeek(season)
  for (const refused of ['2026-01', '2026-01-06', '2026-02-30']) {
    assert(
      (await read(`leaderboard?season=${refused}`)).response.status === 400,
      `the season ${refused} is refused: a season is the YYYY-MM-DD of a Monday`,
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
  const returning = await play(
    'board-three',
    [12, null, null, null, null],
    { profile: { ...profile, name: 'Pebble' } },
    nextWeekAt,
  )
  assert(
    returning.standing.kind === 'ranked' &&
      returning.standing.rank === 1 &&
      returning.entry.listed &&
      returning.entry.season === nextWeek &&
      returning.entry.authorName === 'Pebble',
    "a visitor's first record of a new week stays listed like their last one, under the same name, first at once",
  )
  const someoneElse = await play(
    'board-one',
    [12, null, null, null, null],
    { profile: { ...profile, name: 'Clover', hat: 'cap' } },
    nextWeekAt,
  )
  assert(
    someoneElse.standing.kind === 'consentNeeded' &&
      someoneElse.entry.listed === false &&
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
    renamed.standing.kind === 'consentNeeded' && renamed.entry.listed === false && renamed.entry.authorName === null,
    'a run under another name takes a listed record off the board with its name',
  )
}

/** Each check marks a run that trips it and leaves an ordinary run alone. */
function checkReviewFlags(assert: Assert): void {
  const seed = 31
  const clean = parseDerbySubmission(resultBody(fiveNormal, seed, [12, -21, null, 33, -27]), fiveNormal)
  const flagsOf = (submission: typeof clean) =>
    derbyRunFlags({
      rules: fiveNormal,
      log: submission.log,
      record: judgeDerbyRun(fiveNormal, seed, submission, 60_000),
    })
  assert(flagsOf(clean).length === 0, 'an ordinary run is not marked')
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
    assert(flagsOf(submission).includes(flag), `${flag} marks the run that trips it`)
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
    outcome.run.status === 'scored' && outcome.run.flags.includes('claimed-mismatch'),
    'claimed totals the server does not reach mark the run, which still scores',
  )
}

/**
 * A run belongs to the KST week it was issued in: issued just before Monday midnight it keeps that week's rules and
 * board when its result arrives after; issued at midnight it gets the rules scheduled for the new week.
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
      lateOutcome.entry.season === endingWeek &&
      lateOutcome.standing.kind === 'unlisted',
    'a result arriving after midnight counts at once in the week the run was issued in',
  )
  const listing = { listed: true, profile }
  const day = 24 * 60 * minute
  const listedLate = await service.updateOwnEntry(game, visitorHash, listing, endingWeek, midnight + 6 * day)
  const finalRecord = await rejection(() =>
    service.updateOwnEntry(game, earlierHash, listing, endingWeek, midnight + 3 * minute),
  )
  const tooLate = await rejection(() =>
    service.updateOwnEntry(game, visitorHash, { listed: false }, endingWeek, midnight + 7 * day),
  )
  assert(
    listedLate.entry.listed &&
      listedLate.rank === 1 &&
      finalRecord instanceof DomainError &&
      finalRecord.code === 'INVALID_INPUT' &&
      tooLate instanceof DomainError &&
      tooLate.code === 'INVALID_INPUT',
    "a record whose result arrived after midnight may be listed on its week's board for a week, unlike one there before",
  )
  const early = await service.issueRun(game, visitorHash, midnight, 77)
  assert(
    early.season === newWeek && isDeepStrictEqual(early.rules, sevenHard),
    'a run issued at Monday midnight KST takes the rules scheduled for the new week',
  )
}

/**
 * A result whose request does not look like the game page's own fetch is marked, still scored, and nothing else of
 * the request is kept.
 */
async function checkRequestEvidence(assert: Assert): Promise<void> {
  const { store, service, send, setBallpark } = leaderboardHarness()
  await setBallpark({ visible: true, rules: fiveNormal })
  const cookie = '__Host-tom_visitor=evidence-visitor'
  const visitorHash = await hashToken('evidence-visitor')
  async function sentAs(fetchSite: string | null): Promise<string> {
    const run = await service.issueRun(game, visitorHash, Date.now() - 2 * minute, 404)
    const body = resultBody(fiveNormal, 404, [12, null, null, null, null])
    const response = await send('POST', `/v1/games/${game}/runs/${run.id}/result`, { body, cookie, fetchSite })
    assert(response.status === 200, 'the result is recorded however it was sent')
    const stored = store.gameRuns.get(run.id)
    return `${stored?.status}:${stored?.flags.join()}`
  }
  assert(
    (await sentAs('same-origin')) === 'scored:',
    "a result sent by the game page's own fetch is not marked for where it came from",
  )
  assert(
    (await sentAs(null)) === 'scored:not-from-browser' &&
      (await sentAs('cross-site')) === 'scored:not-from-browser' &&
      (await sentAs('none')) === 'scored:not-from-browser',
    'a result without the headers of a same-origin fetch, as a script sends it, is marked and still scored',
  )
  assert(
    !/sec-fetch|cross-site/iu.test(JSON.stringify([...store.gameRuns.values()])),
    'only the mark is stored, never what the request said of itself',
  )
}
