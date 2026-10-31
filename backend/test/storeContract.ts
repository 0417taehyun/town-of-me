import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import pg from 'pg'
import {
  applyMigrations,
  DomainError,
  parseGuestbookInput,
  parseTownLayout,
  PostgresStore,
  seedTown,
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
  assert((await store.getTown('contract-town')) === null, 'an unsaved town does not exist')
  const lantern = { id: 'lantern-0', type: 'paperLantern', variant: 'tall-red', position: { x: 4, y: 3, z: 4 } }
  const layout = parseTownLayout({
    ...sampleTownLayout,
    movement: { gait: 'hopScotch', skid: 'off' },
    objects: [...sampleTownLayout.objects, lantern],
  })
  const first = await store.saveTown('contract-town', layout, 0)
  assert(first.revision === 1 && first.id === 'contract-town', 'the first save creates revision 1')
  const firstLoaded = await store.getTown('contract-town')
  assert(
    isDeepStrictEqual(firstLoaded?.movement, layout.movement) &&
      isDeepStrictEqual(firstLoaded?.owner, layout.owner) &&
      isDeepStrictEqual(firstLoaded?.pet, layout.pet),
    'the first save stores the movement setting, even an unknown style, and the owner and pet names',
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
  const stale = await rejection(() => store.saveTown('contract-town', layout, 0))
  assert(stale instanceof DomainError && stale.code === 'CONFLICT', 'a save from an old revision is refused')

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
    objects: [
      { ...house, position: { x: 12, y: 0, z: 30 }, color: '#123abc' },
      ...layout.objects.filter((object) => object !== house),
    ],
  }
  const second = await store.saveTown('contract-town', edited, first.revision)
  assert(second.revision === 2, 'each save advances the revision')
  const loaded = await store.getTown('contract-town')
  assert(loaded?.revision === 2 && loaded.objects.length === edited.objects.length, 'the latest layout is returned')
  assert(
    isDeepStrictEqual(loaded.movement, edited.movement) &&
      isDeepStrictEqual(loaded.owner, edited.owner) &&
      isDeepStrictEqual(loaded.pet, edited.pet),
    "a later save replaces the movement setting, the owner's introduction, contact email, resident, and questions, and the pet's route",
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
  await store.saveTown('contract-town', { ...edited, residents: [] }, 2)
  assert((await store.getTown('contract-town'))?.residents.length === 0, 'a save removes residents left out of it')
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
  await checkTownStore(store, assert)
  await checkTownSeed(store, assert)

  await checkGuestbookStore(store, assert)
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

/** The sample town fills a missing town once and never overwrites the admin's edits. */
async function checkTownSeed(store: Store, assert: Assert): Promise<void> {
  const warnings: string[] = []
  const logger = { log: () => undefined, warn: (message: string) => void warnings.push(message) }
  await seedTown(store, seedFile, logger)
  const seeded = await store.getTown('mossbell')
  assert(
    seeded?.revision === 1 && seeded.owner.name.en === 'Robin' && warnings.length === 0,
    'the sample town seeds a missing town as revision 1',
  )
  await store.saveTown('mossbell', { ...seeded, name: 'Edited Mossbell' }, 1)
  await seedTown(store, seedFile, logger)
  const kept = await store.getTown('mossbell')
  assert(kept?.revision === 2 && kept.name === 'Edited Mossbell', 'seeding never overwrites an existing town')
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
      `UPDATE towns SET owner = owner - 'introduction' - 'contactEmail' - 'residentId' - 'questions', pet = pet - 'route'`,
    )
    const earlier = await new PostgresStore(pool).getTown('mossbell')
    assert(
      earlier?.owner.introduction === null &&
        earlier.owner.contactEmail === null &&
        earlier.owner.residentId === null &&
        isDeepStrictEqual(earlier.owner.questions, []) &&
        earlier.pet.route === null,
      "a town saved before the introduction, contact email, owner's resident and questions, and pet route existed reads them as null or empty",
    )
  } finally {
    await pool.end()
    await administration.query(`DROP SCHEMA ${schema} CASCADE`)
    await administration.end()
  }
}
