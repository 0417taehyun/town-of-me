import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import {
  applyMigrations,
  DomainError,
  MemoryStore,
  parseCharacterAppearance,
  parseGuestbookInput,
  parseTownLayout,
  parseTownVenues,
  PostgresStore,
  seedMissingTown,
  seedTown,
  type EntrySettlement,
  type FinishedRun,
  type GameRun,
  type LeaderboardEntry,
  type SettleEntry,
  type SiteEventCount,
  type Store,
  type VerifiedLinkedInIdentity,
} from '../src/index.js'
import { sampleTownLayout } from './townFlow.js'

type Assert = (condition: unknown, message: string) => asserts condition

const migrationsDirectory = new URL('../../migrations/', import.meta.url)
const seedFile = fileURLToPath(new URL('../../seed/town.json', import.meta.url))

async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  return action().then(
    () => null,
    (error: unknown) => error,
  )
}

/** A town save replaces the whole layout, keeps its order and type-specific fields, and refuses stale revisions. */
async function checkTownStore(store: Store, assert: Assert): Promise<void> {
  const seeded = await store.getTown()
  assert(seeded, 'the seed check leaves a town')
  const lantern = { id: 'lantern-0', type: 'paperLantern', variant: 'tall-red', position: { x: 4, y: 3, z: 4 } }
  const venues = {
    ballpark: {
      visible: true,
      theme: 'garden',
      colors: { roof: '#e8735a' },
      // A month that has passed: a save could no longer schedule it, but a stored schedule always reads.
      scheduledRules: { fromMonth: '2025-11', rules: { pitchCount: 7, difficulty: 'hard' } },
    },
  }
  const layout = parseTownLayout({
    ...sampleTownLayout,
    movement: { gait: 'hopScotch', skid: 'off' },
    venues,
    objects: [...sampleTownLayout.objects, lantern],
  })
  const first = await store.saveTown(layout, seeded.revision)
  assert(first.revision === seeded.revision + 1 && !('id' in first), 'a save advances the revision and names no town')
  const firstLoaded = await store.getTown()
  assert(firstLoaded && !('id' in firstLoaded), 'a read names no town')
  assert(
    isDeepStrictEqual(firstLoaded?.movement, layout.movement) &&
      isDeepStrictEqual(firstLoaded?.owner, layout.owner) &&
      isDeepStrictEqual(firstLoaded?.pet, layout.pet),
    'the first save stores the movement setting, even an unknown style, and the owner and pet names',
  )
  assert(
    isDeepStrictEqual(firstLoaded?.venues, layout.venues) &&
      firstLoaded?.venues.ballpark.visible === true &&
      firstLoaded.venues.ballpark.scheduledRules,
    'the first save stores the venues: the ballpark shown, with a color override and a schedule whose month has passed',
  )
  assert(
    firstLoaded?.owner.introduction === null &&
      firstLoaded.owner.contactEmail === null &&
      firstLoaded.pet.route === null,
    'an omitted introduction, contact email, and pet route read as null',
  )
  const loadedLantern = firstLoaded?.objects.find(({ id }) => id === lantern.id)
  assert(
    loadedLantern?.type === lantern.type && loadedLantern.variant === lantern.variant,
    'an object kind the backend does not know keeps its type and variant',
  )
  const stale = await rejection(() => store.saveTown(layout, seeded.revision))
  assert(stale instanceof DomainError && stale.code === 'CONFLICT', 'a save from an old revision is refused')
  const anotherFirst = await rejection(() => store.saveTown(layout, 0))
  assert(
    anotherFirst instanceof DomainError && anotherFirst.code === 'CONFLICT',
    'a first save is refused once a town exists',
  )

  const road = layout.objects.find(({ type }) => type === 'road')
  const bench = layout.objects.find(({ type }) => type === 'bench')
  const house = layout.objects.find(({ type }) => type === 'house')
  assert(road && bench && house, 'the sample layout needs a road, a bench, and a house')
  const edited = {
    ...layout,
    owner: {
      name: { ko: '로빈 리', en: 'Robin Lee' },
      introduction: { ko: '안녕하세요.\n로빈이에요.', en: 'Hello.\nI am Robin.' },
      contactEmail: 'robin@example.com',
      residentId: 'maple',
      questions: [
        {
          question: { ko: '요즘 뭘 만들어요?', en: 'What are you building?' },
          answer: { ko: '작은 도서관이요.\n분수 옆에요.', en: 'A small library.\nBy the fountain.' },
        },
        { question: { ko: '연락은요?', en: 'How do I reach you?' }, answer: { ko: '메일이요.', en: 'By email.' } },
      ],
    },
    pet: {
      ...layout.pet,
      route: [
        [5, 5],
        [-5, 5],
        [0, -52],
      ] as const,
    },
    movement: { gait: 'plantedFeet', skid: 'short' },
    venues: parseTownVenues({ ballpark: { rules: { pitchCount: 7, difficulty: 'hard' } } }),
    objects: [
      { ...house, position: { x: 12, y: 0, z: 30 }, color: '#123abc' },
      ...layout.objects.filter((object) => object !== house),
    ],
  }
  const second = await store.saveTown(edited, first.revision)
  assert(second.revision === first.revision + 1, 'each save advances the revision')
  const loaded = await store.getTown()
  assert(
    loaded?.revision === second.revision && loaded.objects.length === edited.objects.length,
    'the latest layout is returned',
  )
  assert(
    isDeepStrictEqual(loaded.movement, edited.movement) &&
      isDeepStrictEqual(loaded.owner, edited.owner) &&
      isDeepStrictEqual(loaded.pet, edited.pet),
    "a later save replaces the movement setting, the owner's introduction, contact email, resident, and questions, and the pet's route",
  )
  assert(
    isDeepStrictEqual(loaded.venues, edited.venues) && !loaded.venues.ballpark.visible,
    'a later save replaces the venues: it may hide the ballpark again and drop the schedule',
  )
  const loadedHouse = loaded.objects[0]
  assert(
    loadedHouse?.id === house.id &&
      loadedHouse.position.x === 12 &&
      loadedHouse.color === '#123abc' &&
      loadedHouse.ownerName === house.ownerName &&
      loadedHouse.linkedInProfileUrl === house.linkedInProfileUrl,
    'objects keep their order, transform, color, and house mailbox fields',
  )
  const loadedRoad = loaded.objects.find(({ id }) => id === road.id)
  const loadedBench = loaded.objects.find(({ id }) => id === bench.id)
  assert(
    JSON.stringify(loadedRoad?.points) === JSON.stringify(road.points) &&
      loadedRoad?.width === road.width &&
      loadedBench?.seats === bench.seats,
    'road points, road width, and bench seats round-trip',
  )
  const [resident] = loaded.residents
  assert(
    resident?.benchId === bench.id &&
      resident.appearance.colors.top === layout.residents[0]?.appearance.colors.top &&
      JSON.stringify(resident.route) === JSON.stringify(layout.residents[0]?.route) &&
      // jsonb stores object keys in its own order, so compare values rather than serialized text.
      isDeepStrictEqual(resident.role, layout.residents[0]?.role) &&
      isDeepStrictEqual(resident.relationship, layout.residents[0]?.relationship) &&
      resident.linkedInProfileUrl === layout.residents[0]?.linkedInProfileUrl &&
      isDeepStrictEqual(resident.dialogue, layout.residents[0]?.dialogue),
    'residents round-trip with their appearance, route, bench, profile, and dialogue',
  )
  await store.saveTown({ ...edited, residents: [] }, second.revision)
  assert((await store.getTown())?.residents.length === 0, 'a save removes residents left out of it')
}

/** Behavior every Store implementation must share, so MemoryStore stays a faithful stand-in for PostgreSQL. */
export async function checkStoreContract(store: Store, assert: Assert): Promise<void> {
  await store.saveTransaction({
    id: 'transaction-id',
    state: 'state',
    nonce: 'nonce',
    expiresAt: Date.now() + 60_000,
  })
  const transaction = await store.consumeTransaction('transaction-id')
  assert(transaction?.state === 'state' && transaction.nonce === 'nonce', 'store must return a saved OIDC transaction')
  assert((await store.consumeTransaction('transaction-id')) === null, 'an OIDC transaction must be single-use')

  const identity: VerifiedLinkedInIdentity = {
    issuer: 'https://www.linkedin.com',
    subject: 'contract-subject',
    displayName: 'First Name',
    email: null,
    emailVerified: false,
    pictureUrl: null,
  }
  const member = await store.upsertLinkedUser(identity)
  const renamed = await store.upsertLinkedUser({ ...identity, displayName: 'Renamed' })
  assert(renamed.id === member.id && renamed.displayName === 'Renamed', 'upsert must keep one user per OIDC subject')
  assert(member.role === 'member', 'new users start as members')

  await store.saveSession('member-token-hash', member.id, Date.now() + 60_000)
  const memberActor = await store.resolveSession('member-token-hash', Date.now())
  assert(
    memberActor?.kind === 'linked' && memberActor.userId === member.id && memberActor.role === 'member',
    'a session resolves to its user and current role',
  )
  assert(
    (await store.resolveSession('member-token-hash', Date.now() + 120_000)) === null,
    'store must reject an expired session',
  )
  await store.saveSession('logout-token-hash', member.id, Date.now() + 60_000)
  await store.deleteSession('logout-token-hash')
  assert(
    (await store.resolveSession('logout-token-hash', Date.now())) === null,
    'a logged-out session must not resolve',
  )

  const now = Date.now()
  await store.saveTransaction({ id: 'expired-transaction', state: 'state', nonce: 'nonce', expiresAt: now - 1 })
  await store.saveTransaction({ id: 'live-transaction', state: 'state', nonce: 'nonce', expiresAt: now + 60_000 })
  await store.saveSession('expiring-token-hash', member.id, now + 1_000)
  await store.saveSession('live-token-hash', member.id, now + 120_000)
  await store.deleteExpiredSessionsAndTransactions(now + 60_000)
  assert(
    (await store.consumeTransaction('expired-transaction')) === null &&
      (await store.resolveSession('expiring-token-hash', now)) === null,
    'expired sign-in transactions and sessions are deleted',
  )
  assert(
    (await store.consumeTransaction('live-transaction')) !== null &&
      (await store.resolveSession('live-token-hash', now)) !== null,
    'live sign-in transactions and sessions are kept',
  )

  assert((await store.getUser(crypto.randomUUID())) === null, 'unknown users must resolve to null')

  await checkAdminEmailStore(store, identity, assert)
  await checkTownSeed(store, assert)
  await checkTownStore(store, assert)

  await checkGuestbookStore(store, assert)
  await checkRunStore(store, assert)
  await checkEntryStore(store, assert)
  await checkModerationStore(store, assert)
  await checkVisitorRace(store, assert)
  await checkSiteStatsStore(store, assert)
}

/** The admin list is seeded once, decides the role at every sign-in, and removing an email ends that role at once. */
async function checkAdminEmailStore(store: Store, identity: VerifiedLinkedInIdentity, assert: Assert): Promise<void> {
  assert(await store.seedAdminEmails(['second@example.com', 'first@example.com']), 'an empty admin list is seeded')
  assert(!(await store.seedAdminEmails(['other@example.com'])), 'an admin list that has emails is never seeded again')
  const added = await store.addAdminEmail('third@example.com')
  assert(added.email === 'third@example.com' && Date.parse(added.createdAt) > 0, 'an added email is returned')
  assert(
    (await store.listAdminEmails()).map(({ email }) => email).join() ===
      'first@example.com,second@example.com,third@example.com',
    'admin emails are listed by email',
  )
  const duplicate = await rejection(() => store.addAdminEmail('first@example.com'))
  assert(duplicate instanceof DomainError && duplicate.code === 'CONFLICT', 'an email is listed only once')

  // LinkedIn's spelling of the address is stored as given; the list matches it trimmed and lowercase.
  const admin = await store.upsertLinkedUser({ ...identity, subject: 'contract-admin', email: ' Second@Example.com ' })
  const bystander = await store.upsertLinkedUser({ ...identity, subject: 'contract-bystander' })
  assert(
    (await store.assignRoleByEmail(admin.id, 'second@example.com')).role === 'admin',
    'a listed email signs in as admin',
  )
  assert(
    (await store.assignRoleByEmail(admin.id, 'changed@example.com')).role === 'member' &&
      (await store.getUser(admin.id))?.role === 'member',
    'an admin whose email is not listed signs in as a member',
  )
  await store.assignRoleByEmail(admin.id, 'second@example.com')
  await store.saveSession('admin-token-hash', admin.id, Date.now() + 60_000)
  await store.saveSession('bystander-token-hash', bystander.id, Date.now() + 60_000)
  await store.removeAdminEmail('second@example.com')
  assert(
    (await store.getUser(admin.id))?.role === 'member' &&
      (await store.resolveSession('admin-token-hash', Date.now())) === null,
    'removing an email demotes its users and ends their sessions at once',
  )
  assert(
    (await store.resolveSession('bystander-token-hash', Date.now())) !== null,
    'removing an email keeps other sessions',
  )
  const missing = await rejection(() => store.removeAdminEmail('second@example.com'))
  assert(missing instanceof DomainError && missing.code === 'NOT_FOUND', 'an unlisted email cannot be removed')
  await store.removeAdminEmail('third@example.com')
  const last = await rejection(() => store.removeAdminEmail('first@example.com'))
  assert(
    last instanceof DomainError && last.code === 'CONFLICT' && (await store.listAdminEmails()).length === 1,
    'the last admin email cannot be removed',
  )
}

/** Writes `town` as a private seed would be, with an `id` key, and hands its path to `work`. */
async function withSeedFile(town: unknown, work: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'town-seed-'))
  try {
    const file = join(directory, 'town.json')
    await writeFile(file, JSON.stringify(town))
    await work(file)
  } finally {
    await rm(directory, { recursive: true })
  }
}

/** The sample town fills a missing town once and never overwrites the admin's edits. */
async function checkTownSeed(store: Store, assert: Assert): Promise<void> {
  assert((await store.getTown()) === null, 'an unsaved town does not exist')
  assert(await seedMissingTown(new MemoryStore(), seedFile), 'the sample seed file loads')
  const warnings: string[] = []
  const logger = { log: () => undefined, warn: (message: string) => void warnings.push(message) }
  const sample = JSON.parse(await readFile(seedFile, 'utf8')) as Record<string, unknown>
  await withSeedFile({ ...sample, id: 'Any Old Id!' }, (file) => seedTown(store, file, logger))
  const seeded = await store.getTown()
  assert(
    seeded?.revision === 1 && seeded.owner.name.en === 'Robin' && warnings.length === 0,
    'a seed file with an id key seeds a missing town as revision 1',
  )
  await store.saveTown({ ...seeded, name: 'Edited Mossbell' }, 1)
  await seedTown(store, seedFile, logger)
  const kept = await store.getTown()
  assert(
    kept?.revision === 2 && kept.name === 'Edited Mossbell' && warnings.length === 0,
    'seeding quietly leaves an existing town as it is',
  )
  await seedTown(store, `${seedFile}.missing`, logger)
  assert(
    warnings.some((warning) => warning.includes('town.json.missing')),
    'a missing seed file is logged instead of stopping the server',
  )
}

/** Entries are listed by status, found by visitor, and only updated from the version that was read. */
async function checkGuestbookStore(store: Store, assert: Assert): Promise<void> {
  // The frontend sends a whole `PlayerProfile`; only the name and appearance are stored.
  const profile = {
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
  const fields = parseGuestbookInput({ profile, message: '첫 방문\n반가워요', locale: 'ko' })
  const entry = (id: string, visitorHash: string, time: number, status: 'pending' | 'approved') => ({
    ...fields,
    id,
    visitorHash,
    status,
    createdAt: new Date(time).toISOString(),
    updatedAt: new Date(time).toISOString(),
  })
  const older = entry(crypto.randomUUID(), 'visitor-a', 1_000, 'pending')
  const newer = entry(crypto.randomUUID(), 'visitor-a', 2_000, 'approved')
  const other = entry(crypto.randomUUID(), 'visitor-b', 3_000, 'pending')
  for (const item of [older, newer, other]) await store.insertGuestbookEntry(item)

  const approved = await store.listGuestbookEntries({ status: 'approved', limit: 10 })
  assert(approved.length === 1 && approved[0]?.id === newer.id, 'visitors list only approved entries')
  const everything = await store.listGuestbookEntries({ limit: 2 })
  assert(
    everything.map(({ id }) => id).join() === [other.id, newer.id].join(),
    'review lists every status, newest first',
  )
  assert(
    (await store.getLatestGuestbookEntryByVisitor('visitor-a'))?.id === newer.id &&
      (await store.getLatestGuestbookEntryByVisitor('visitor-c')) === null,
    'the latest entry is found by visitor',
  )

  const stale = await store.updateGuestbookEntry(older.id, new Date(9_000).toISOString(), { status: 'approved' })
  assert(
    stale === null && (await store.getGuestbookEntry(older.id))?.status === 'pending',
    'stale updates change nothing',
  )
  const revisedAt = new Date(4_000).toISOString()
  const revised = await store.updateGuestbookEntry(older.id, older.updatedAt, {
    message: '다시 왔어요',
    status: 'approved',
    updatedAt: revisedAt,
  })
  const loaded = await store.getGuestbookEntry(older.id)
  assert(
    revised?.message === '다시 왔어요' &&
      loaded?.message === '다시 왔어요' &&
      loaded.status === 'approved' &&
      loaded.updatedAt === revisedAt &&
      loaded.createdAt === older.createdAt &&
      loaded.appearance.name === profile.name &&
      !('genderIdentity' in loaded.appearance),
    'an update from the current version changes only the given fields',
  )
  assert(
    (await store.updateGuestbookEntry(crypto.randomUUID(), revisedAt, { status: 'approved' })) === null,
    'updating a missing entry reports nothing to update',
  )
  await store.deleteGuestbookEntry(older.id)
  assert((await store.getGuestbookEntry(older.id)) === null, 'deleted guestbook entries must disappear')
}

const runGame = 'home-run-derby'
const runIssuedAt = Date.parse('2026-10-20T03:00:00.000Z')
const runAppearance = parseCharacterAppearance(
  {
    hair: 'bob',
    hat: 'none',
    eyes: 'happy',
    ears: 'round',
    nose: 'button',
    mouth: 'smile',
    mustache: 'none',
    top: 'sweater',
    bottom: 'trousers',
    shoes: 'sneakers',
    colors: { skin: '#e9ba99', hair: '#503a2e', hat: '#638fab', top: '#ca7765', bottom: '#ece3cc', shoes: '#374b65' },
  },
  'appearance',
)

function issuedRun(visitorHash: string, season = '2026-10'): GameRun {
  return {
    id: crypto.randomUUID(),
    game: runGame,
    season,
    visitorHash,
    // The largest 32-bit unsigned seed, which a 32-bit signed column would not hold.
    seed: 4_294_967_295,
    rules: { pitchCount: 5, difficulty: 'normal' },
    status: 'issued',
    issuedAt: new Date(runIssuedAt).toISOString(),
    expiresAt: new Date(runIssuedAt + 10 * 60_000).toISOString(),
    submittedAt: null,
    inputLog: null,
    result: null,
    score: null,
    tiebreak: null,
    flags: [],
    profile: null,
    reviewedAt: null,
  }
}

const scoredRun = {
  status: 'scored' as const,
  submittedAt: new Date(runIssuedAt + 60_000).toISOString(),
  inputLog: {
    side: 'left' as const,
    practice: [{ errorMs: 96.4, speed: 8.1 }],
    swings: [{ contactMs: 941.2, startedMs: 722.5, speed: 9.4, heightError: null }, null],
  },
  result: null,
  score: 2,
  tiebreak: 2114,
  flags: [],
  profile: null,
}

function entryFor(run: GameRun, fields: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  const time = new Date(runIssuedAt + 60_000).toISOString()
  return {
    id: crypto.randomUUID(),
    game: run.game,
    season: run.season,
    visitorHash: run.visitorHash,
    bestRunId: run.id,
    score: 2,
    tiebreak: 2114,
    result: {
      homeRuns: 2,
      totalDistanceDm: 2114,
      pitches: [{ pitchType: 'curve', outcome: 'homeRun', distanceDm: 1204 }],
    },
    achievedAt: time,
    authorName: null,
    nameStatus: null,
    appearance: runAppearance,
    appearancePublic: true,
    listed: false,
    reviewStatus: 'pending',
    linkedIn: null,
    takedown: false,
    createdAt: time,
    updatedAt: time,
    ...fields,
  }
}

/** Stores `entry` as its visitor's record, through a scored run of its own like the service does. */
async function recordEntry(store: Store, visitorHash: string, season: string, fields: Partial<LeaderboardEntry>) {
  const run = issuedRun(visitorHash, season)
  await store.issueRun(run)
  const entry = entryFor(run, fields)
  await store.finishRun(run.id, visitorHash, scoredRun, () => ({ entry, changed: true, consentNeeded: false }))
  return entry
}

/** A visitor has one open run per game, and a run is finished once, before it expires, by its own visitor. */
async function checkRunStore(store: Store, assert: Assert): Promise<void> {
  const first = issuedRun('run-visitor')
  const bystander = issuedRun('run-bystander')
  await store.issueRun(first)
  await store.issueRun(bystander)
  assert(isDeepStrictEqual(await store.getRun(first.id), first), 'an issued run round-trips with its seed and rules')
  const second = issuedRun('run-visitor')
  await store.issueRun(second)
  assert(
    (await store.getRun(first.id))?.status === 'abandoned' &&
      (await store.getRun(second.id))?.status === 'issued' &&
      (await store.getRun(bystander.id))?.status === 'issued',
    "a new run abandons the visitor's open one and no one else's",
  )
  const racing = [issuedRun('run-racer'), issuedRun('run-racer')]
  await Promise.all(racing.map((run) => store.issueRun(run)))
  const racingStatuses = await Promise.all(racing.map(async (run) => (await store.getRun(run.id))?.status))
  assert(
    racingStatuses.sort().join() === 'abandoned,issued',
    'two runs issued at once for one visitor leave exactly one open',
  )

  assert(
    (await store.finishRun(second.id, 'run-bystander', scoredRun, null)) === null &&
      (await store.finishRun(first.id, 'run-visitor', scoredRun, null)) === null,
    'a run cannot be finished by another visitor, nor once it is abandoned',
  )
  const atExpiry = { ...scoredRun, submittedAt: second.expiresAt }
  assert((await store.finishRun(second.id, 'run-visitor', atExpiry, null)) === null, 'an expired run is not finished')
  const results = await Promise.all([
    store.finishRun(second.id, 'run-visitor', scoredRun, null),
    store.finishRun(second.id, 'run-visitor', { ...scoredRun, score: 5 }, null),
  ])
  assert(
    results.filter((result) => result !== null).length === 1,
    'two results for one run at the same moment finish it once',
  )
  const finished = await store.getRun(second.id)
  assert(
    finished?.status === 'scored' &&
      finished.submittedAt === scoredRun.submittedAt &&
      isDeepStrictEqual(finished.inputLog, scoredRun.inputLog) &&
      finished.score === results.find((result) => result !== null)?.run.score,
    'a finished run keeps its log, score, and when it arrived',
  )
  assert(
    (await store.finishRun(second.id, 'run-visitor', scoredRun, null)) === null,
    'a finished run cannot be finished again',
  )
}

/** A record is settled with the run that changes it, from the visitor's record on that board or their latest one. */
async function checkEntryStore(store: Store, assert: Assert): Promise<void> {
  const october = await recordEntry(store, 'entry-visitor', '2026-09', {
    listed: true,
    authorName: 'Sprout',
    nameStatus: 'approved',
  })
  const run = issuedRun('entry-visitor')
  await store.issueRun(run)
  const seen: Array<[LeaderboardEntry | null, LeaderboardEntry | null]> = []
  const first = entryFor(run, { listed: true, authorName: 'Sprout', nameStatus: 'pending' })
  const settled = await store.finishRun(run.id, 'entry-visitor', scoredRun, (current, latest) => {
    seen.push([current, latest])
    return { entry: first, changed: true, consentNeeded: false }
  })
  assert(
    seen.length === 1 && seen[0]?.[0] === null && isDeepStrictEqual(seen[0][1], october),
    "a first record on a board is settled from the visitor's latest record of the game",
  )
  assert(
    isDeepStrictEqual(settled?.settlement?.entry, first) &&
      isDeepStrictEqual(await store.getBoardEntryByVisitor(run, 'entry-visitor'), first),
    'the settled record is stored with its name, appearance, and result',
  )
  const next = issuedRun('entry-visitor')
  await store.issueRun(next)
  const unchanged: EntrySettlement = { entry: { ...first, score: 9 }, changed: false, consentNeeded: false }
  await store.finishRun(next.id, 'entry-visitor', scoredRun, (current, latest) => {
    seen.push([current, latest])
    return unchanged
  })
  assert(
    isDeepStrictEqual(seen[1], [first, null]) &&
      (await store.getBoardEntryByVisitor(run, 'entry-visitor'))?.score === first.score,
    'a later run is settled from the record on its board, and an unchanged settlement writes nothing',
  )

  const season = '2026-08'
  const tied = new Date(runIssuedAt).toISOString()
  const later = new Date(runIssuedAt + 1).toISOString()
  const listed = { listed: true, authorName: 'Batter', nameStatus: 'pending' as const }
  const leader = await recordEntry(store, 'rank-leader', season, {
    ...listed,
    score: 4,
    tiebreak: 100,
    achievedAt: tied,
  })
  await recordEntry(store, 'rank-hidden', season, { score: 5, tiebreak: 9000 })
  await recordEntry(store, 'rank-out', season, { ...listed, score: 5, tiebreak: 9000, reviewStatus: 'disqualified' })
  const [lowId = '', highId = ''] = [crypto.randomUUID(), crypto.randomUUID()].sort()
  const earlier = await recordEntry(store, 'rank-early', season, {
    ...listed,
    score: 3,
    tiebreak: 500,
    achievedAt: tied,
    id: highId,
  })
  const sameMoment = await recordEntry(store, 'rank-same', season, {
    ...listed,
    score: 3,
    tiebreak: 500,
    achievedAt: tied,
    id: lowId,
  })
  const latecomer = await recordEntry(store, 'rank-late', season, {
    ...listed,
    score: 3,
    tiebreak: 500,
    achievedAt: later,
  })
  const ranks = await Promise.all([leader, sameMoment, earlier, latecomer].map((entry) => store.rankOf(entry)))
  assert(
    ranks.join() === '1,2,3,4',
    'places follow home runs, then distance, then the earlier record, then the id, counting only listed records on the board',
  )
  assert(
    (await store.rankOf({ ...latecomer, listed: false, score: 4, tiebreak: 100, achievedAt: later })) === 2,
    'an unlisted record is told the place it would take',
  )
  const board = await store.listBoard({ game: runGame, season }, 3)
  assert(
    board.map(({ id }) => id).join() === [leader, sameMoment, earlier].map(({ id }) => id).join(),
    'the board lists listed, not disqualified records in public order, up to the limit',
  )
  const ended = await store.listEndedSeasons(runGame, '2026-10')
  assert(
    ended.indexOf('2026-09') !== -1 &&
      ended.indexOf('2026-09') < ended.indexOf(season) &&
      new Set(ended).size === ended.length &&
      !(await store.listEndedSeasons(runGame, '2026-09')).includes('2026-09') &&
      (await store.listEndedSeasons('another-game', '2026-10')).length === 0,
    "the ended seasons are a game's seasons before the given one, each once, newest first",
  )

  const changes = {
    authorName: null,
    nameStatus: null,
    appearance: { ...runAppearance, hat: 'cap' },
    appearancePublic: false,
    listed: false,
    reviewStatus: 'disqualified' as const,
    linkedIn: null,
    takedown: true,
    updatedAt: new Date(runIssuedAt + 5 * 60_000).toISOString(),
  }
  assert(
    (await store.updateEntry(leader.id, new Date(runIssuedAt + 9 * 60_000).toISOString(), changes)) === null &&
      isDeepStrictEqual(await store.getBoardEntryByVisitor(leader, 'rank-leader'), leader),
    'an update from a version that is no longer current changes nothing',
  )
  const updated = await store.updateEntry(leader.id, leader.updatedAt, changes)
  assert(
    isDeepStrictEqual(updated, { ...leader, ...changes }) &&
      isDeepStrictEqual(await store.getBoardEntryByVisitor(leader, 'rank-leader'), updated),
    'an update from the current version replaces the name, its status, the appearance and its showing, listing, review, and takedown',
  )
}

/** A held run is reviewed once, reports and blocks are kept, and a visitor's deletion takes every season with it. */
async function checkModerationStore(store: Store, assert: Assert): Promise<void> {
  const season = '2026-07'
  const board = { game: runGame, season }
  const reviewedAt = new Date(runIssuedAt + 3 * 60_000).toISOString()
  const heldProfile = { name: 'Sprout', appearance: runAppearance }
  const flagged = { ...scoredRun, status: 'flagged' as const, flags: ['claimed-mismatch'], profile: heldProfile }
  const held = issuedRun('moderation-held', season)
  await store.issueRun(held)
  await store.finishRun(held.id, 'moderation-held', flagged, null)
  const waiting = await store.listRunsForReview(board)
  assert(
    waiting.length === 1 && isDeepStrictEqual(waiting[0]?.profile, heldProfile) && waiting[0]?.reviewedAt === null,
    'a held run waits for review with the profile it was sent with',
  )
  const refused = await rejection(() =>
    store.acceptRun(held.id, reviewedAt, () => {
      throw new DomainError('CONFLICT', 'The record changed')
    }),
  )
  assert(
    refused instanceof DomainError &&
      (await store.getRun(held.id))?.reviewedAt === null &&
      (await store.getBoardEntryByVisitor(board, 'moderation-held')) === null,
    'an acceptance its settlement refuses changes neither the run nor the record',
  )
  const linkedIn = {
    profileUrl: 'https://www.linkedin.com/in/sprout-sample',
    status: 'pending' as const,
    code: 'TOM-7KQ2',
  }
  const entry = entryFor(held, { listed: true, authorName: 'Sprout', nameStatus: 'pending', linkedIn })
  const settled = () => ({ entry, changed: true, consentNeeded: false })
  const accepted = await store.acceptRun(held.id, reviewedAt, settled)
  assert(
    accepted?.run.status === 'scored' &&
      accepted.run.reviewedAt === reviewedAt &&
      isDeepStrictEqual(await store.getEntry(entry.id), entry),
    'an accepted run scores and settles its record in one step, link and all',
  )
  assert(
    accepted?.run.profile === null && (await store.getRun(held.id))?.profile === null,
    'an accepted run no longer keeps the name and look it was sent with',
  )
  assert(
    (await store.acceptRun(held.id, reviewedAt, settled)) === null &&
      (await store.listRunsForReview(board)).length === 0,
    'a held run is accepted once and leaves the queue',
  )
  const approvedLink = { ...entry, linkedIn: { ...linkedIn, status: 'approved' as const }, updatedAt: reviewedAt }
  assert(
    isDeepStrictEqual(await store.updateEntry(entry.id, entry.updatedAt, approvedLink), approvedLink),
    "an update replaces the record's link",
  )

  const abandoned = issuedRun('moderation-dismissed', season)
  const dismissed = issuedRun('moderation-dismissed', season)
  await store.issueRun(abandoned)
  await store.issueRun(dismissed)
  await store.finishRun(dismissed.id, 'moderation-dismissed', flagged, null)
  assert(
    (await store.rejectRun(dismissed.id, reviewedAt))?.status === 'flagged' &&
      (await store.rejectRun(dismissed.id, reviewedAt)) === null &&
      (await store.listRunsForReview(board)).length === 0,
    'a dismissed run stays held as evidence and leaves the queue once',
  )
  await checkListedDismissal(store, flagged, reviewedAt, assert)
  await checkTakenDownProfiles(store, flagged, reviewedAt, assert)
  const counts = await store.countRunsByVisitor(board)
  assert(
    isDeepStrictEqual(
      counts.find(({ visitorHash }) => visitorHash === 'moderation-dismissed'),
      { visitorHash: 'moderation-dismissed', runs: 2, abandoned: 1, flagged: 1 },
    ) && counts.length === 2,
    "a board counts each visitor's runs, abandoned runs, and held runs",
  )
  await store.issueRun(issuedRun('moderation-unplayed', season))
  assert(
    (await store.hasSubmittedRun(runGame, 'moderation-dismissed')) &&
      !(await store.hasSubmittedRun(runGame, 'moderation-unplayed')),
    'only a visitor who sent a result has played',
  )

  const unlisted = await recordEntry(store, 'moderation-unlisted', season, { score: 9 })
  assert(
    (await store.listEntries(board)).map(({ id }) => id).join() === [unlisted.id, entry.id].join(),
    'every record on the board is listed, unlisted ones too, in public order',
  )

  const report = (target: 'name' | 'link', reason: 'mine' | 'other', minutes: number) => ({
    id: crypto.randomUUID(),
    entryId: entry.id,
    target,
    reason,
    createdAt: new Date(runIssuedAt + minutes * 60_000).toISOString(),
    resolvedAt: null,
    resolution: null,
  })
  const nameReport = report('name', 'other', 4)
  const linkReport = report('link', 'mine', 5)
  await store.addReport(nameReport)
  await store.addReport(linkReport)
  await store.resolveReports(entry.id, 'name', 'kept', reviewedAt)
  assert(
    isDeepStrictEqual(await store.listReports(board), [
      { ...nameReport, resolvedAt: reviewedAt, resolution: 'kept' },
      linkReport,
    ]) && (await store.listReports({ game: runGame, season: '2026-06' })).length === 0,
    "resolving closes the record's open reports on one target only, and reports are listed by board",
  )
  await store.forgetKeptReports(entry.id, ['link'])
  await store.forgetKeptReports(entry.id, ['name'])
  assert(
    isDeepStrictEqual(await store.listReports(board), [linkReport]),
    "forgetting a target's kept reports deletes those only, never an open report",
  )

  await store.blockLink('blocked-profile-hash', reviewedAt)
  await store.blockLink('blocked-profile-hash', reviewedAt)
  assert(
    (await store.isLinkBlocked('blocked-profile-hash')) && !(await store.isLinkBlocked('other-profile-hash')),
    'a blocked link stays blocked, however often it is blocked',
  )

  const earlier = await recordEntry(store, 'moderation-held', '2026-06', {})
  await store.eraseVisitorGameData(runGame, 'moderation-held')
  assert(
    (await store.getEntry(entry.id)) === null &&
      (await store.getEntry(earlier.id)) === null &&
      (await store.getRun(held.id)) === null &&
      (await store.listReports(board)).length === 0 &&
      (await store.getEntry(unlisted.id)) !== null,
    "a visitor's deletion removes their runs, records, and the reports on them in every season, and no one else's",
  )
}

/** A record taken down takes the name and look off its visitor's runs on that board, and off nothing else. */
async function checkTakenDownProfiles(
  store: Store,
  flagged: FinishedRun,
  reviewedAt: string,
  assert: Assert,
): Promise<void> {
  const season = '2026-03'
  const held = async (visitorHash: string, month = season) => {
    const run = issuedRun(visitorHash, month)
    await store.issueRun(run)
    await store.finishRun(run.id, visitorHash, flagged, null)
    return run
  }
  const entry = await recordEntry(store, 'takedown-visitor', season, {})
  const waiting = await held('takedown-visitor')
  const dismissed = await held('takedown-visitor')
  await store.rejectRun(dismissed.id, reviewedAt)
  const otherVisitor = await held('takedown-other')
  const otherSeason = await held('takedown-visitor', '2026-02')
  const profileOf = async (run: GameRun) => (await store.getRun(run.id))?.profile ?? null

  const takenDown = { ...entry, takedown: true, appearancePublic: false, updatedAt: reviewedAt }
  assert(
    (await store.updateEntry(entry.id, '2000-01-01T00:00:00.000Z', takenDown)) === null &&
      (await profileOf(waiting)) !== null,
    'a takedown refused as stale leaves the runs as they are',
  )
  const relisted = { ...entry, listed: true, updatedAt: reviewedAt }
  await store.updateEntry(entry.id, entry.updatedAt, relisted)
  assert((await profileOf(waiting)) !== null, 'any other change to a record leaves its runs as they are')

  const applied = await store.updateEntry(entry.id, reviewedAt, { ...takenDown, updatedAt: runAfter(reviewedAt) })
  assert(
    applied?.takedown === true && (await profileOf(waiting)) === null && (await profileOf(dismissed)) === null,
    "a takedown takes the name and look off the visitor's runs on that board, waiting or dismissed",
  )
  assert(
    (await profileOf(otherVisitor)) !== null && (await profileOf(otherSeason)) !== null,
    "a takedown leaves another visitor's runs and the visitor's other seasons as they are",
  )
}

/** Dismissing a list takes only what is listed, still waiting, and of the game, and says how many that was. */
async function checkListedDismissal(
  store: Store,
  flagged: FinishedRun,
  reviewedAt: string,
  assert: Assert,
): Promise<void> {
  const season = '2026-04'
  const finished = async (visitorHash: string, outcome: FinishedRun, game = runGame) => {
    const run = { ...issuedRun(visitorHash, season), game }
    await store.issueRun(run)
    await store.finishRun(run.id, visitorHash, outcome, null)
    return run
  }
  const listed = await finished('dismissal-listed', flagged)
  const late = await finished('dismissal-late', flagged)
  const scored = await finished('dismissal-scored', scoredRun)
  const otherGame = await finished('dismissal-other', flagged, 'another-game')
  const named = [listed.id, scored.id, otherGame.id, crypto.randomUUID()]
  assert(
    (await store.rejectRuns(runGame, named, reviewedAt)) === 1 &&
      (await store.getRun(listed.id))?.reviewedAt === reviewedAt &&
      (await store.getRun(late.id))?.reviewedAt === null &&
      (await store.getRun(scored.id))?.reviewedAt === null &&
      (await store.getRun(otherGame.id))?.reviewedAt === null,
    'a listed dismissal takes only the listed runs that wait, of that game, and leaves a run it did not name',
  )
  assert((await store.rejectRuns(runGame, [listed.id], reviewedAt)) === 0, 'a run is dismissed only once')
}

function runAfter(time: string): string {
  return new Date(Date.parse(time) + 1).toISOString()
}

/** The visitor's record as it stands, or `entry` when there is none yet. */
function settleOnto(entry: LeaderboardEntry): SettleEntry {
  return (current) =>
    current ? { entry: current, changed: false, consentNeeded: false } : { entry, changed: true, consentNeeded: false }
}

/** A held run accepted, the visitor's next run finished, and all their data erased, at the same moment. */
async function raceVisitor(store: Store, visitorHash: string) {
  const season = '2026-05'
  const flagged = { ...scoredRun, status: 'flagged' as const, flags: ['claimed-mismatch'] }
  const held = issuedRun(visitorHash, season)
  await store.issueRun(held)
  await store.finishRun(held.id, visitorHash, flagged, null)
  const next = issuedRun(visitorHash, season)
  await store.issueRun(next)
  const results = await Promise.allSettled([
    store.acceptRun(held.id, new Date(runIssuedAt + 2 * 60_000).toISOString(), settleOnto(entryFor(held))),
    store.finishRun(next.id, visitorHash, scoredRun, settleOnto(entryFor(next))),
    store.eraseVisitorGameData(runGame, visitorHash),
  ])
  return { results, left: await store.getBoardEntryByVisitor({ game: runGame, season }, visitorHash) }
}

/**
 * What creates or deletes one visitor's records happens one at a time: two runs settling at once never both insert a
 * first record, and an erasure at the same moment leaves none. PostgreSQL shows it; MemoryStore runs each step whole.
 */
async function checkVisitorRace(store: Store, assert: Assert): Promise<void> {
  const raced = await Promise.all(
    ['race-a', 'race-b', 'race-c', 'race-d'].map((visitor) => raceVisitor(store, visitor)),
  )
  assert(
    raced.every(({ results, left }) => results.every(({ status }) => status === 'fulfilled') && left === null),
    "settling and erasing one visitor's records at once never fails, and the erasure leaves no record",
  )
}

/**
 * A daily total only ever grows by one in one step, so increments at the same moment lose nothing; PostgreSQL shows it.
 * The notes' KST days and the game's months are read from what is already stored, by both stores the same way.
 */
async function checkSiteStatsStore(store: Store, assert: Assert): Promise<void> {
  const day = '2031-03-01'
  const increments = Array.from({ length: 60 }, () => store.addSiteEvent(day, 'map-opened', ''))
  await Promise.all(increments)
  await store.addSiteEvent(day, 'resident-talk', 'fern')
  await store.addSiteEvent(day, 'resident-talk', 'fern')
  await store.addSiteEvent(day, 'resident-talk', 'moss')
  await store.addSiteEvent('2031-02-28', 'map-opened', '')
  await store.addSiteEvent('2031-03-02', 'map-opened', '')
  const inOrder = (counts: readonly SiteEventCount[]) =>
    [...counts].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  assert(
    isDeepStrictEqual(inOrder(await store.listSiteEventCounts(day, day)), [
      { day, event: 'map-opened', subject: '', count: 60 },
      { day, event: 'resident-talk', subject: 'fern', count: 2 },
      { day, event: 'resident-talk', subject: 'moss', count: 1 },
    ]),
    'increments at the same moment lose no count, and a total is kept per day, event, and subject',
  )
  assert(
    (await store.listSiteEventCounts('2031-02-28', '2031-03-02')).length === 5 &&
      (await store.listSiteEventCounts('2031-03-03', '2031-03-09')).length === 0,
    'a read includes both of its days and no other',
  )

  const profile = { ...runAppearance, name: 'Sprout' }
  const note = (time: string, status: 'pending' | 'approved') => ({
    id: crypto.randomUUID(),
    visitorHash: `stats-${time}`,
    appearance: profile,
    message: 'Hello',
    locale: 'en' as const,
    status,
    createdAt: time,
    updatedAt: time,
  })
  // 00:00 on the 2nd in KST is 15:00 on the 1st in UTC.
  await store.insertGuestbookEntry(note('2031-03-01T14:59:59.999Z', 'pending'))
  await store.insertGuestbookEntry(note('2031-03-01T15:00:00.000Z', 'approved'))
  await store.insertGuestbookEntry(note('2031-03-02T14:59:59.999Z', 'approved'))
  await store.insertGuestbookEntry(note('2031-03-02T15:00:00.000Z', 'pending'))
  const notes = await store.countGuestbookEntriesByDay('2031-03-01', '2031-03-02')
  assert(
    isDeepStrictEqual(
      notes.sort((left, right) => left.day.localeCompare(right.day)),
      [
        { day: '2031-03-01', status: 'pending', count: 1 },
        { day: '2031-03-02', status: 'approved', count: 2 },
      ],
    ),
    'notes count on the KST day they were written, by status, and a note on either side of the range counts for neither',
  )

  await store.issueRun(issuedRun('stats-visitor', '2031-03'))
  await recordEntry(store, 'stats-visitor', '2031-03', {})
  await recordEntry(store, 'stats-other', '2031-04', {})
  await store.issueRun({ ...issuedRun('stats-visitor', '2031-04'), game: 'other-game' })
  const months = await store.countGameMonths(runGame)
  assert(
    isDeepStrictEqual(months.slice(0, 2), [
      { month: '2031-04', runs: 1, records: 1 },
      { month: '2031-03', runs: 2, records: 1 },
    ]) && (await store.countGameMonths('other-game')).length === 1,
    "a game's months come newest first, each with its runs and records, and another game's stay apart",
  )
}

/**
 * A database filled while towns were addressed by id: its town reads and saves under the id it has, seeding adds no
 * second one, and a database holding several reads and saves the same one and loses none.
 */
async function checkTownUnderAnyId(pool: pg.Pool, assert: Assert): Promise<void> {
  const store = new PostgresStore(pool)
  const layout = parseTownLayout(sampleTownLayout)
  const isConflict = (error: unknown) => error instanceof DomainError && error.code === 'CONFLICT'
  const rowsOf = async (query: string) => JSON.stringify((await pool.query(query)).rows)
  const townRows = () => rowsOf('SELECT id, name, revision FROM towns ORDER BY id')
  const insertTown = async (id: string, name: string, revision: number) => {
    await pool.query(
      `INSERT INTO towns (id, name, spawn, movement, owner, pet, venues, revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        name,
        JSON.stringify(layout.spawn),
        JSON.stringify(layout.movement),
        JSON.stringify(layout.owner),
        JSON.stringify(layout.pet),
        JSON.stringify(layout.venues),
        revision,
      ],
    )
    await pool.query(
      `INSERT INTO town_objects (town_id, id, sort_order, type, position_x, position_y, position_z)
       VALUES ($1, 'old-bench', 0, 'bench', 0, 0, 0)`,
      [id],
    )
    await pool.query(
      `INSERT INTO town_residents (town_id, id, sort_order, name, appearance, route, bench_object_id, seat_index)
       VALUES ($1, 'old-resident', 0, 'Fern', $2, '[]', 'old-bench', 0)`,
      [id, JSON.stringify(layout.residents[0]?.appearance)],
    )
  }
  const logger = { log: () => undefined, warn: () => undefined }

  await pool.query('DELETE FROM towns')
  await insertTown('old-town', 'Old Town', 4)
  const read = await store.getTown()
  assert(
    read?.name === 'Old Town' &&
      read.revision === 4 &&
      read.objects[0]?.id === 'old-bench' &&
      read.residents[0]?.id === 'old-resident',
    'a town stored under any id reads with its objects and residents',
  )
  await seedTown(store, seedFile, logger)
  await withSeedFile({ ...sampleTownLayout, id: 'old-town' }, (file) => seedTown(store, file, logger))
  await withSeedFile({ ...sampleTownLayout, id: 'new-town' }, (file) => seedTown(store, file, logger))
  assert(
    (await townRows()) === JSON.stringify([{ id: 'old-town', name: 'Old Town', revision: 4 }]),
    'seeding adds no town to a database holding one, nor changes it, whatever id the seed names',
  )
  assert(isConflict(await rejection(() => store.saveTown(layout, 0))), 'a first save adds no second town')
  assert(isConflict(await rejection(() => store.saveTown(layout, 3))), 'a stale save is refused under any id')
  const saved = await store.saveTown(layout, 4)
  assert(
    saved.revision === 5 && (await townRows()) === JSON.stringify([{ id: 'old-town', name: layout.name, revision: 5 }]),
    'a save advances the town under the id it has',
  )
  const savedChildren = await rowsOf(
    `SELECT town_id, count(*)::int FROM (SELECT town_id FROM town_objects UNION ALL SELECT town_id FROM town_residents) AS child
     GROUP BY town_id`,
  )
  assert(
    savedChildren === JSON.stringify([{ town_id: 'old-town', count: layout.objects.length + layout.residents.length }]),
    "a save replaces the objects and residents under the town's id",
  )

  await insertTown('stale-copy', 'Stale Copy', 2)
  assert((await store.getTown())?.name === layout.name, 'a database holding several reads the most edited')
  await store.saveTown({ ...layout, name: 'Saved Again' }, 5)
  assert(
    (await townRows()) ===
      JSON.stringify([
        { id: 'old-town', name: 'Saved Again', revision: 6 },
        { id: 'stale-copy', name: 'Stale Copy', revision: 2 },
      ]),
    'a save goes to the town that reads, and leaves the others as they are',
  )
  assert(
    (await rowsOf(`SELECT count(*)::int FROM town_objects WHERE town_id = 'stale-copy'`)) ===
      JSON.stringify([{ count: 1 }]),
    "a save leaves the other towns' objects",
  )

  await pool.query('DELETE FROM towns')
  const raced = await Promise.allSettled([store.saveTown(layout, 0), store.saveTown(layout, 0)])
  const refused = raced.filter(({ status }) => status === 'rejected') as PromiseRejectedResult[]
  assert(
    refused.length === 1 &&
      isConflict(refused[0]?.reason) &&
      (await rowsOf('SELECT count(*)::int FROM towns')) === JSON.stringify([{ count: 1 }]),
    'two first saves at once make one town, and the other hears the town changed',
  )
}

/** Runs the contract in a throwaway schema so a developer database can double as the test database. */
export async function checkPostgresStoreContract(connectionString: string | undefined, assert: Assert): Promise<void> {
  if (!connectionString) {
    console.log('skip - PostgresStore contract (set TEST_DATABASE_URL to run it)')
    return
  }
  const schema = `store_contract_${crypto.randomUUID().replaceAll('-', '')}`
  const administration = new pg.Pool({ connectionString })
  await administration.query(`CREATE SCHEMA ${schema}`)
  // SET on connect instead of a startup `options` parameter, which poolers and PGlite ignore.
  const pool = new pg.Pool({
    connectionString,
    onConnect: async (client) => {
      await client.query(`SET search_path TO ${schema}`)
    },
  })
  try {
    assert(
      (await pool.query<{ search_path: string }>('SHOW search_path')).rows[0]?.search_path === schema,
      'contract queries must run in the throwaway schema',
    )
    assert((await applyMigrations(pool, migrationsDirectory)).length > 0, 'migrations must apply to an empty schema')
    assert((await applyMigrations(pool, migrationsDirectory)).length === 0, 'migrations must apply only once')
    await checkStoreContract(new PostgresStore(pool), assert)
    await pool.query(
      `UPDATE towns SET owner = owner - 'introduction' - 'contactEmail' - 'residentId' - 'questions', pet = pet - 'route',
         venues = '{}'`,
    )
    const earlier = await new PostgresStore(pool).getTown()
    assert(
      earlier?.owner.introduction === null &&
        earlier.owner.contactEmail === null &&
        earlier.owner.residentId === null &&
        isDeepStrictEqual(earlier.owner.questions, []) &&
        earlier.pet.route === null,
      "a town saved before the introduction, contact email, owner's resident and questions, and pet route existed reads them as null or empty",
    )
    assert(
      isDeepStrictEqual(earlier.venues, {
        ballpark: { visible: false, theme: 'garden', colors: {}, rules: { pitchCount: 5, difficulty: 'normal' } },
      }),
      'a town saved before venues existed keeps the ballpark hidden, with the default look and rules',
    )
    await checkTownUnderAnyId(pool, assert)
  } finally {
    await pool.end()
    await administration.query(`DROP SCHEMA ${schema} CASCADE`)
    await administration.end()
  }
}
