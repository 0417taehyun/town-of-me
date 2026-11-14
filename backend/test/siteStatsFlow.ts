import { isDeepStrictEqual } from 'node:util'
import {
  BackendService,
  createApi,
  hashToken,
  MemoryStore,
  parseTownLayout,
  siteEvents,
  weeksInRange,
} from '../src/index.js'
import { sampleTownLayout } from './townFlow.js'

type Assert = (condition: unknown, message: string) => asserts condition

const origin = 'https://town.example'

/** Anyone adds to anonymous daily totals, and the answer never says whether anything was counted; only an admin reads. */
export async function checkSiteStatsFlow(assert: Assert): Promise<void> {
  const store = new MemoryStore()
  const service = new BackendService(store)
  const errors: unknown[] = []
  const api = createApi({
    service,
    authStore: store,
    allowedOrigins: new Set([origin]),
    frontendUrl: `${origin}/`,
    logger: { warn: () => undefined, error: (error: unknown) => errors.push(error) },
  })
  await store.saveTown(parseTownLayout(sampleTownLayout), 0)
  const resident = sampleTownLayout.residents[0]?.id ?? ''

  function event(body: unknown, headers: Record<string, string> = {}): Request {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    const allHeaders = { Origin: origin, 'Content-Type': 'application/json', ...headers }
    return new Request(`${origin}/v1/events`, { method: 'POST', headers: allHeaders, body: text })
  }
  const total = () => [...store.siteEventCounts.values()].reduce((sum, { count }) => sum + count, 0)
  /** Sends `request`, expects the one answer every event gets, and says how much the totals grew. */
  async function counted(request: Request, message: string): Promise<number> {
    const before = total()
    const response = await api(request)
    assert(response.status === 204 && (await response.text()) === '', `an event answers 204 with no body: ${message}`)
    return total() - before
  }

  assert((await counted(event({ event: 'map-opened' }), 'a listed event')) === 1, 'a listed event is counted')
  /** One at a time, since `counted` measures the totals around each. */
  async function countedEach(requests: ReadonlyArray<[string, unknown]>): Promise<number[]> {
    const counts: number[] = []
    for (const [name, body] of requests) counts.push(await counted(event(body), name))
    return counts
  }
  const everyEvent = siteEvents.filter((name) => name !== 'resident-talk')
  const everyCount = await countedEach(everyEvent.map((name) => [name, { event: name }]))
  assert(
    everyCount.every((count) => count === 1),
    'every listed event without a subject counts',
  )
  const refused: Array<[string, unknown]> = [
    ['an event not on the list', { event: 'free text' }],
    ['a prototype key', { event: '__proto__' }],
    ['an event that is not text', { event: ['map-opened'] }],
    ['no event', {}],
    ['a body that is not an object', ['map-opened']],
    ['a body that is not JSON', '{"event":'],
    ['a body too large to be an event', { event: 'map-opened', padding: 'x'.repeat(2000) }],
    ['a conversation naming nobody', { event: 'resident-talk' }],
    ['a conversation naming no resident', { event: 'resident-talk', subject: 'a stranger writes this' }],
    ['a subject that is not text', { event: 'resident-talk', subject: { id: resident } }],
    ['a subject on an event that takes none', { event: 'map-opened', subject: resident }],
    ['free text on an event that takes no subject', { event: 'map-opened', subject: 'a stranger writes this' }],
  ]
  const refusedCounts = await countedEach(refused)
  assert(
    refusedCounts.every((count) => count === 0),
    `nothing else is counted: ${refused.filter((_item, index) => refusedCounts[index] !== 0).map(([name]) => name)}`,
  )
  assert(
    (await counted(
      new Request(`${origin}/v1/events`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'text/plain' },
        body: '{"event":"map-opened"}',
      }),
      'a body that says it is not JSON',
    )) === 0,
    'a body that says it is not JSON is not counted',
  )
  assert(
    (await counted(event({ event: 'resident-talk', subject: resident }), 'a resident of the town')) === 1,
    'a conversation with a resident of the town is counted',
  )
  const subjects = [...store.siteEventCounts.values()].map(({ subject }) => subject)
  assert(
    subjects.every((subject) => subject === '' || subject === resident),
    'only a resident of the town ever reaches the table as a subject',
  )

  const foreign = await api(event({ event: 'map-opened' }, { Origin: 'https://elsewhere.example' }))
  const before = total()
  assert(foreign.status === 403 && total() === before, 'an event from another site is refused and not counted')

  // Reads of the Cookie header, however a route would reach them.
  const withCookie = event({ event: 'map-opened' }, { Cookie: '__Host-tom_visitor=fern; __Host-tom_session=moss' })
  const readHeader = withCookie.headers.get.bind(withCookie.headers)
  let cookieReads = 0
  withCookie.headers.get = (name: string) => {
    cookieReads += Number(name.toLowerCase() === 'cookie')
    return readHeader(name)
  }
  const cookied = await api(withCookie)
  assert(cookied.status === 204 && cookied.headers.get('Set-Cookie') === null, 'an event sets no cookie')
  assert(cookieReads === 0, 'an event reads no cookie')

  const failing = new MemoryStore()
  failing.addSiteEvent = () => Promise.reject(new Error('the store is down'))
  const failingApi = createApi({
    service: new BackendService(failing),
    authStore: failing,
    allowedOrigins: new Set([origin]),
    frontendUrl: `${origin}/`,
    logger: { warn: () => undefined, error: (error: unknown) => errors.push(error) },
  })
  const failed = await failingApi(event({ event: 'map-opened' }))
  assert(failed.status === 204 && errors.length === 1, 'a store failure is logged and still answers the same')

  async function signedIn(subject: string, email: string): Promise<string> {
    const user = await store.upsertLinkedUser({
      issuer: 'https://www.linkedin.com',
      subject,
      displayName: subject,
      email,
      emailVerified: true,
      pictureUrl: null,
    })
    await store.assignRoleByEmail(user.id, email)
    await store.saveSession(await hashToken(`${subject}-session`), user.id, Date.now() + 60_000)
    return `__Host-tom_session=${subject}-session`
  }
  await store.seedAdminEmails(['stats-admin@example.com'])
  const admin = await signedIn('stats-admin', 'stats-admin@example.com')
  const member = await signedIn('stats-member', 'stats-member@example.com')
  const stats = (query: string, cookie?: string) =>
    api(new Request(`${origin}/v1/admin/stats${query}`, { headers: cookie ? { Cookie: cookie } : {} }))

  assert((await stats('')).status === 401, 'a signed-out reader gets 401')
  assert((await stats('', member)).status === 403, 'a member gets 403')
  assert((await stats('?days=abc')).status === 401, 'the gate comes before the query, so a stranger learns nothing')
  const read = await stats('', admin)
  assert(read.status === 200 && read.headers.get('Cache-Control') === 'no-store', 'an admin reads, uncached')
  const invalidDays = ['0', '366', 'abc', '-1', '1e2', '1.5', '']
  const invalidStatuses = await Promise.all(
    invalidDays.map(async (days) => (await stats(`?days=${days}`, admin)).status),
  )
  assert(
    invalidStatuses.every((status) => status === 400),
    `days must be a whole number in range: ${invalidStatuses}`,
  )
  assert((await stats('?days=365', admin)).status === 200, 'a year is the longest range')

  // The KST day boundary: 00:00 on the 2nd in KST is 15:00 on the 1st in UTC.
  const kst = new MemoryStore()
  const kstService = new BackendService(kst)
  const adminActor = { kind: 'linked', userId: 'admin', role: 'admin' } as const
  await kst.saveTown(parseTownLayout(sampleTownLayout), 0)
  await kstService.recordSiteEvent({ event: 'map-opened' }, Date.parse('2031-02-28T15:00:00.000Z'))
  await kstService.recordSiteEvent({ event: 'map-opened' }, Date.parse('2031-03-01T14:59:59.999Z'))
  await kstService.recordSiteEvent({ event: 'photo-taken' }, Date.parse('2031-03-01T15:00:00.000Z'))
  await kstService.recordSiteEvent({ event: 'photo-taken' }, Date.parse('2031-02-28T14:59:59.999Z'))
  await kstService.recordSiteEvent(
    { event: 'resident-talk', subject: resident },
    Date.parse('2031-03-01T00:00:00.000Z'),
  )
  await kstService.recordSiteEvent(
    { event: 'resident-talk', subject: resident },
    Date.parse('2031-03-01T15:00:00.000Z'),
  )
  await kst.addSiteEvent('2031-03-02', 'resident-talk', 'gone')
  await kst.addSiteEvent('2031-03-02', 'resident-talk', 'gone')
  await kst.addSiteEvent('2031-03-02', 'resident-talk', 'gone')
  const signed = (visitorHash: string, time: string) =>
    kstService.signGuestbook(
      visitorHash,
      { message: 'Hello', locale: 'en', profile: { ...sampleTownLayout.residents[0]?.appearance, name: 'Sprout' } },
      Date.parse(time),
    )
  await signed('note-before', '2031-02-28T14:59:59.999Z')
  await signed('note-first', '2031-02-28T15:00:00.000Z')
  await signed('note-second', '2031-03-01T15:00:00.000Z')
  const approved = await signed('note-third', '2031-03-01T15:00:00.000Z')
  await kstService.approveGuestbookEntry(adminActor, approved.id, approved.updatedAt)
  // The first moment of the 2nd in KST, when UTC is still on the 1st.
  const window = await kstService.getSiteStats(adminActor, '2', Date.parse('2031-03-01T15:00:00.000Z'))
  assert(
    isDeepStrictEqual(window.range, { from: '2031-03-01', to: '2031-03-02', days: 2 }),
    'a range ends with the KST day of now, and two days are that day and the one before',
  )
  assert(
    isDeepStrictEqual(window.daily, [
      { day: '2031-03-01', event: 'map-opened', count: 2 },
      { day: '2031-03-01', event: 'resident-talk', count: 1 },
      { day: '2031-03-02', event: 'photo-taken', count: 1 },
      { day: '2031-03-02', event: 'resident-talk', count: 4 },
    ]),
    'each count lands on its KST day, its subjects summed, and a count before the range is left out',
  )
  assert(
    isDeepStrictEqual(
      window.residents.map(({ id, conversations }) => [id, conversations]),
      [
        [resident, 2],
        ['gone', 3],
      ].sort((left, right) => Number(right[1]) - Number(left[1])),
    ) && window.residents.find(({ id }) => id === 'gone')?.name === null,
    'residents rank by conversations in the range, and a removed one is kept without a name',
  )
  assert(
    isDeepStrictEqual(window.guestbook, {
      byStatus: { pending: 2, approved: 1 },
      byDay: [
        { day: '2031-03-01', count: 1 },
        { day: '2031-03-02', count: 2 },
      ],
    }),
    'the notes of the range count by status and by KST day, and a note before it counts for neither',
  )
  assert(
    !/hash|visitor|cookie|address/iu.test(JSON.stringify(window)),
    'what the admin reads holds nothing about a visitor',
  )
  const empty = await kstService.getSiteStats(adminActor, '1', Date.parse('2040-01-01T00:00:00.000Z'))
  assert(
    empty.daily.length === 0 &&
      empty.residents.every(({ conversations }) => conversations === 0) &&
      empty.residents.some(({ id }) => id === resident),
    'a day with nothing counted still lists the residents, at zero',
  )
  // 2031-03-01 is a Saturday, in the week of Monday 2031-02-24.
  const weeks = ['2031-03-03', '2031-02-24', '2031-02-17'].map((week) => ({ week, runs: 1, records: 0 }))
  assert(
    weeksInRange(weeks, { from: '2031-03-01', to: '2031-03-07', days: 7 })
      .map(({ week }) => week)
      .join() === '2031-03-03,2031-02-24',
    "the game's seasons of a range are the weeks with a day in it: the week its first day falls in, not the one before",
  )
}
