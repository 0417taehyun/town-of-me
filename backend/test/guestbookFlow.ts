import {
  BackendService,
  createApi,
  DomainError,
  guestbookWritingWindowMs,
  hashToken,
  MemoryStore,
} from '../src/index.js'

type Assert = (condition: unknown, message: string) => asserts condition

const origin = 'https://town.example'
/** The frontend sends its whole `PlayerProfile`; the API keeps only the name and appearance. */
const profile = {
  name: 'Maple',
  genderIdentity: 'self-described',
  genderDescription: 'Private detail',
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
  linkedInProfileUrl: 'https://www.linkedin.com/in/maple',
}

type Entry = {
  id: string
  name: string
  messages: Record<string, string>
  profile: object
  status?: string
  revisable?: boolean
  updatedAt?: string
}

/** Anyone signs once a day and may revise that entry; nothing is shown to others until the admin approves it. */
export async function checkGuestbookFlow(assert: Assert): Promise<void> {
  const store = new MemoryStore()
  const service = new BackendService(store)
  const api = createApi({
    service,
    authStore: store,
    allowedOrigins: new Set([origin]),
    frontendUrl: `${origin}/`,
  })

  function send(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string; origin?: string | null } = {},
  ): Promise<Response> {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (options.origin !== null) headers.set('Origin', options.origin ?? origin)
    if (options.cookie) headers.set('Cookie', options.cookie)
    const body = options.body === undefined ? null : JSON.stringify(options.body)
    return api(new Request(`${origin}${path}`, { method, headers, body }))
  }

  async function read(cookie?: string): Promise<{ entries: Entry[]; own: Entry | null }> {
    return (await (await send('GET', '/v1/guestbook', cookie ? { cookie } : {})).json()) as {
      entries: Entry[]
      own: Entry | null
    }
  }

  async function signedIn(subject: string): Promise<string> {
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

  const note = (message: string, locale = 'en') => ({ message, locale, profile })
  await store.seedAdminEmails(['guestbook-admin@example.com'])
  const admin = await signedIn('guestbook-admin')
  const member = await signedIn('guestbook-member')

  const empty = await send('GET', '/v1/guestbook')
  assert(empty.headers.get('Cache-Control') === 'no-store', 'the guestbook is never cached for others')
  assert((await read()).entries.length === 0 && (await read()).own === null, 'visitors can read an empty guestbook')
  assert(
    (await send('POST', '/v1/guestbook', { body: note('Hi'), origin: null })).status === 403,
    'browser guestbook writes must come from an allowed origin',
  )

  const created = await send('POST', '/v1/guestbook', { body: note('  분수대가 좋아요\r\n또 올게요  ', 'ko') })
  assert(created.status === 201, 'an anonymous visitor can sign the guestbook')
  const visitorCookie = created.headers.get('Set-Cookie')?.split(';')[0] ?? ''
  assert(visitorCookie.startsWith('__Host-tom_visitor='), 'the first entry gives the browser a visitor cookie')
  const { entry } = (await created.json()) as { entry: Entry }
  assert(entry.messages.ko === '분수대가 좋아요\n또 올게요', 'messages keep line breaks and are trimmed')
  assert(entry.status === 'pending' && entry.revisable === true, 'a new entry waits for review and can be revised')
  assert(
    entry.name === 'Maple' &&
      !('genderIdentity' in entry.profile) &&
      !('linkedInProfileUrl' in entry.profile) &&
      !JSON.stringify(entry).includes('visitor'),
    'entries show the character but not gender, the LinkedIn link, or the visitor id',
  )

  const ownView = await read(visitorCookie)
  assert(ownView.entries.length === 0, 'an entry awaiting review is hidden from the public list')
  assert(ownView.own?.id === entry.id && ownView.own.status === 'pending', 'the writer still sees their own entry')
  assert((await read()).own === null, 'other visitors do not get someone else’s entry')

  assert(
    (await send('POST', '/v1/guestbook', { body: note('Again'), cookie: visitorCookie })).status === 409,
    'a visitor leaves one entry a day',
  )
  const otherVisitor = await send('POST', '/v1/guestbook', { body: note('Someone else') })
  const otherCookie = otherVisitor.headers.get('Set-Cookie')?.split(';')[0] ?? ''
  assert(otherVisitor.status === 201, 'another browser may sign too')
  assert(
    (await send('PUT', `/v1/guestbook/${entry.id}`, { body: note('Hijack'), cookie: otherCookie })).status === 404,
    'a visitor cannot revise someone else’s entry',
  )
  assert(
    (await send('PUT', `/v1/guestbook/${entry.id}`, { body: note('No cookie') })).status === 404,
    'revising needs the visitor cookie',
  )

  assert((await send('GET', '/v1/admin/guestbook')).status === 401, 'review requires sign-in')
  assert((await send('GET', '/v1/admin/guestbook', { cookie: member })).status === 403, 'only the admin reviews')
  const review = async () =>
    ((await (await send('GET', '/v1/admin/guestbook', { cookie: admin })).json()) as { entries: Entry[] }).entries
  const pending = (await review()).find(({ id }) => id === entry.id)
  assert(pending?.status === 'pending' && pending.updatedAt, 'the admin sees entries awaiting review')

  const revised = await send('PUT', `/v1/guestbook/${entry.id}`, { body: note('Revised note'), cookie: visitorCookie })
  assert(revised.status === 200, 'the writer can revise today’s entry')
  const approveSeen = (updatedAt: unknown) =>
    send('POST', `/v1/admin/guestbook/${entry.id}/approval`, { body: { updatedAt }, cookie: admin })
  assert((await approveSeen(pending.updatedAt)).status === 409, 'the admin cannot approve text they have not seen')
  const current = (await review()).find(({ id }) => id === entry.id)
  assert(current?.messages.en === 'Revised note', 'the review list shows the latest revision')
  assert(
    (await send('POST', `/v1/admin/guestbook/${entry.id}/approval`, { body: { updatedAt: current.updatedAt } }))
      .status === 401,
    'approving requires sign-in',
  )
  assert((await approveSeen(current.updatedAt)).status === 200, 'the admin approves the entry they read')
  const published = await read()
  assert(published.entries[0]?.messages.en === 'Revised note', 'approved entries appear in the public list')

  await send('PUT', `/v1/guestbook/${entry.id}`, { body: note('Changed after approval'), cookie: visitorCookie })
  assert((await read()).entries.length === 0, 'a revision is hidden again until it is approved')

  const invalidCases: Array<[string, unknown]> = [
    ['an empty message', note('   ')],
    ['a message over 240 characters', note('가'.repeat(241), 'ko')],
    ['a message with a tab', note('tab\there')],
    ['an unsupported locale', note('Hi', 'fr')],
    ['a missing character', { message: 'Hi', locale: 'en' }],
    ['a character without a name', { ...note('Hi'), profile: { ...profile, name: ' ' } }],
    ['an invalid character color', { ...note('Hi'), profile: { ...profile, colors: { ...profile.colors, top: 1 } } }],
  ]
  for (const [label, body] of invalidCases) {
    assert((await send('POST', '/v1/guestbook', { body })).status === 400, `${label} is rejected`)
  }

  const visitor = await hashToken('day-visitor')
  const firstDay = await service.signGuestbook(visitor, note('Day one'), Date.now())
  const nextDay = Date.now() + guestbookWritingWindowMs
  const yesterday = await service.reviseGuestbookEntry(visitor, firstDay.id, note('Late'), nextDay).then(
    () => null,
    (error: unknown) => error,
  )
  assert(yesterday instanceof DomainError && yesterday.code === 'CONFLICT', 'yesterday’s entry is no longer revised')
  assert(
    (await service.signGuestbook(visitor, note('Day two'), nextDay)).id !== firstDay.id,
    'the next day the visitor may write a new entry',
  )

  assert(
    (await send('DELETE', `/v1/admin/guestbook/${entry.id}`, { cookie: member })).status === 403,
    'only the admin deletes',
  )
  assert(
    (await send('DELETE', `/v1/admin/guestbook/${entry.id}`, { cookie: admin })).status === 204,
    'the admin deletes',
  )
  assert((await send('DELETE', `/v1/admin/guestbook/${entry.id}`, { cookie: admin })).status === 404, 'deleted is gone')
}
