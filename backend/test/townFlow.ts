import { isDeepStrictEqual } from 'node:util'
import {
  BackendService,
  createApi,
  DomainError,
  hashToken,
  MemoryStore,
  parseTownLayout,
  parseTownVenues,
} from '../src/index.js'

type Assert = (condition: unknown, message: string) => asserts condition

const origin = 'https://town.example'
const defaultRules = { pitchCount: 5, difficulty: 'normal' }
const appearance = {
  hat: 'none',
  eyes: 'happy',
  nose: 'button',
  mouth: 'smile',
  mustache: 'none',
  ears: 'round',
  hair: 'bob',
  top: 'sweater',
  bottom: 'relaxed trousers',
  shoes: 'sneakers',
  colors: { skin: '#e9ba99', hair: '#503a2e', hat: '#638fab', top: '#ca7765', bottom: '#ece3cc', shoes: '#374b65' },
}

/** The body frontend/src/data/townApi.ts `serializeTownLayout` sends, without `baseRevision`. */
export const sampleTownLayout = {
  name: 'Mossbell',
  owner: { name: { ko: '로빈', en: 'Robin' } },
  pet: { name: { ko: '토토', en: 'Toto' } },
  spawn: { x: 0, y: 1.2, z: 6 },
  objects: [
    { id: 'fountain', type: 'fountain', position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 'guestbook', type: 'guestbook', position: { x: 0, y: 0, z: -5.2 }, rotation: 0, scale: 1 },
    {
      id: 'road-north-south',
      type: 'road',
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      scale: 1,
      color: '#D7C79F',
      points: [
        [0, -53],
        [2, -17],
        [0, 53],
      ],
      width: 6,
    },
    { id: 'bench-west', type: 'bench', position: { x: -8, y: 0, z: 4 }, rotation: 0, scale: 1, seats: 1 },
    {
      id: 'house-owner',
      type: 'house',
      position: { x: -29, y: 0, z: -24 },
      rotation: 0,
      scale: 1,
      color: '#d9826f',
      ownerName: 'Robin',
      description: 'Builder of this little town',
      linkedInProfileUrl: 'https://linkedin.com/in/robin-sample?trk=profile',
    },
    { id: 'tree-0', type: 'tree', position: { x: -47, y: 0, z: -44 }, rotation: 0.4, scale: 0.82, color: null },
    { id: 'bird-0', type: 'bird', position: { x: 60, y: 7, z: -40 }, rotation: 0, scale: 1, color: '#348ec4' },
    { id: 'cloud-0', type: 'cloud', position: { x: -90, y: 13, z: 30 }, rotation: 0, scale: 1.4 },
  ],
  residents: [
    {
      id: 'maple',
      name: 'Maple',
      appearance,
      route: [
        [3, 4],
        [17, 3],
        [24, -8],
      ],
      benchId: 'bench-west',
      seatIndex: 1,
      startSeated: false,
      reference: {
        ko: '로빈은 막히면 먼저 작게 만들어 보고 같이 고민해 줘요.\n코드 리뷰도 꼼꼼해요.',
        en: 'When we got stuck, Robin built a small version first and thought it through with us.\nTheir code reviews are thorough.',
      },
      role: { ko: '모퉁이 빵집 제빵사', en: 'Baker at the corner bakery' },
      relationship: { ko: '오랜 이웃', en: 'Longtime neighbor' },
      linkedInProfileUrl: 'https://linkedin.com/in/%EB%A9%94%EC%9D%B4%ED%94%8C-sample?trk=public',
      dialogue: {
        aboutOwner: { ko: '로빈은 먼저 작게 만들어 보는 사람이에요.', en: 'Robin builds a small version first.' },
        followUps: [
          {
            question: { ko: '기술 관련해서는 어때요?', en: 'How about technical work?' },
            answer: { ko: '코드 리뷰가 꼼꼼해요.', en: 'Their code reviews are thorough.' },
          },
        ],
      },
    },
  ],
}

/** Anyone may read the saved town; only the configured admin may replace it, and never from a stale revision. */
export async function checkTownFlow(assert: Assert): Promise<void> {
  const store = new MemoryStore()
  await store.seedAdminEmails(['town-admin@example.com'])
  const dialogue = sampleTownLayout.residents[0]!.dialogue
  const ownerQuestions = [1, 2, 3, 4, 5].map((number) => ({
    question: { ko: `질문 ${number}`, en: `Question ${number}` },
    answer: { ko: `답 ${number}\n둘째 줄`, en: `Answer ${number}\nSecond line` },
  }))
  const sourcesSeen: unknown[] = []
  const createTownApi = (service: BackendService) =>
    createApi({ service, authStore: store, allowedOrigins: new Set([origin]), frontendUrl: `${origin}/admin` })
  const api = createTownApi(
    new BackendService(store, async (source) => {
      sourcesSeen.push(source)
      return dialogue
    }),
  )
  const apiWithoutLlm = createTownApi(new BackendService(store))

  async function signedIn(subject: string): Promise<{ id: string; cookie: string }> {
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
    return { id: user.id, cookie: `__Host-tom_session=${subject}-session` }
  }

  function save(body: unknown, cookie: string, headers: Record<string, string> = { Origin: origin }) {
    return api(
      new Request(`${origin}/v1/admin/town`, {
        method: 'PUT',
        headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  }

  async function load(): Promise<Response> {
    return api(new Request(`${origin}/v1/town`))
  }

  const member = await signedIn('town-member')
  const admin = await signedIn('town-admin')
  const firstSave = { ...sampleTownLayout, baseRevision: 0 }

  assert((await load()).status === 404, 'a town that was never saved is not found')
  assert((await save(firstSave, member.cookie)).status === 403, 'a signed-in member cannot edit the town')
  assert((await save(firstSave, admin.cookie, {})).status === 403, 'an admin save without an allowed Origin is refused')

  const [fountain, guestbook, road, bench, house, ...otherObjects] = sampleTownLayout.objects
  const [resident] = sampleTownLayout.residents
  assert(fountain && guestbook && road && bench && house && resident, 'the sample layout must stay complete')
  const withResident = (changes: Record<string, unknown>) => ({
    ...firstSave,
    residents: [{ ...resident, ...changes }],
  })
  const withBallpark = (ballpark: Record<string, unknown>) => ({ ...firstSave, venues: { ballpark } })
  const thirteenColors = Object.fromEntries(Array.from({ length: 13 }, (_color, index) => [`role${index}`, '#e8735a']))
  const invalidCases: Array<[string, unknown]> = [
    ['a missing baseRevision', sampleTownLayout],
    ['a negative baseRevision', { ...firstSave, baseRevision: -1 }],
    [
      'an object type that is not a camelCase name',
      { ...firstSave, objects: [...firstSave.objects, { ...fountain, id: 'x', type: 'flying-saucer' }] },
    ],
    ['a second fountain', { ...firstSave, objects: [...firstSave.objects, { ...fountain, id: 'fountain-2' }] }],
    ['a missing guestbook', { ...firstSave, objects: [fountain, road, bench, house, ...otherObjects] }],
    [
      'a duplicate object id',
      { ...firstSave, objects: [...firstSave.objects, { ...bench, position: { x: 9, y: 0, z: 9 } }] },
    ],
    ['an uppercase object id', { ...firstSave, objects: replaced(fountain, { id: 'Fountain' }) }],
    [
      'an object past the town edge',
      { ...firstSave, objects: replaced(fountain, { position: { x: 130, y: 0, z: 0 } }) },
    ],
    ['an invalid color', { ...firstSave, objects: replaced(fountain, { color: 'red' }) }],
    ['a road with one point', { ...firstSave, objects: replaced(road, { points: [[0, 0]] }) }],
    ['a house without an owner name', { ...firstSave, objects: replaced(house, { ownerName: ' ' }) }],
    [
      'a house linking outside LinkedIn profiles',
      { ...firstSave, objects: replaced(house, { linkedInProfileUrl: 'https://example.com/in/robin-sample' }) },
    ],
    ['a resident on an unknown bench', { ...firstSave, residents: [{ ...resident, benchId: 'bench-missing' }] }],
    ['a resident seat outside the route', { ...firstSave, residents: [{ ...resident, seatIndex: 3 }] }],
    ['a reference in only one language', withResident({ reference: { ko: '좋아요', en: ' ' } })],
    ['a reference over 2000 characters', withResident({ reference: { ko: '가'.repeat(2_001), en: 'Hi' } })],
    ['a role over 80 characters', withResident({ role: { ko: '가'.repeat(81), en: 'Designer' } })],
    ['a relationship on two lines', withResident({ relationship: { ko: '같은\n팀', en: 'Teammate' } })],
    [
      'more than three follow-up questions',
      withResident({ dialogue: { ...dialogue, followUps: Array(4).fill(dialogue.followUps[0]) } }),
    ],
    [
      'a follow-up question on two lines',
      withResident({
        dialogue: { ...dialogue, followUps: [{ ...dialogue.followUps[0], question: { ko: '한\n둘', en: 'One' } }] },
      }),
    ],
    ['a gait that is not a style name', { ...firstSave, movement: { gait: 'moon walk' } }],
    ['a town without an owner', { ...firstSave, owner: undefined }],
    ['a town without a pet', { ...firstSave, pet: { name: { ko: '토토' } } }],
    ['a pet name over 24 characters', { ...firstSave, pet: { name: { ko: '토토', en: 'T'.repeat(25) } } }],
    [
      'an owner introduction over 600 characters',
      { ...firstSave, owner: { ...firstSave.owner, introduction: { ko: '가'.repeat(601), en: 'Hi' } } },
    ],
    [
      'an owner contact email without a domain',
      { ...firstSave, owner: { ...firstSave.owner, contactEmail: 'robin@example' } },
    ],
    [
      'an owner LinkedIn link to another site',
      { ...firstSave, owner: { ...firstSave.owner, linkedInProfileUrl: 'https://example.com/in/robin-sample' } },
    ],
    ['an owner resident that is not in the town', { ...firstSave, owner: { ...firstSave.owner, residentId: 'robin' } }],
    [
      'more than five owner questions',
      { ...firstSave, owner: { ...firstSave.owner, questions: [...ownerQuestions, ownerQuestions[0]] } },
    ],
    [
      'a pet route of two points',
      {
        ...firstSave,
        pet: {
          ...firstSave.pet,
          route: [
            [0, 8],
            [8, 0],
          ],
        },
      },
    ],
    [
      'a pet route past the ground edge',
      {
        ...firstSave,
        pet: {
          ...firstSave.pet,
          route: [
            [0, 8],
            [8, 0],
            [0, 53],
          ],
        },
      },
    ],
    ['a pitch count under three', withBallpark({ rules: { pitchCount: 2 } })],
    ['a pitch count over ten', withBallpark({ rules: { pitchCount: 11 } })],
    ['a fractional pitch count', withBallpark({ rules: { pitchCount: 4.5 } })],
    ['a pitch count sent as text', withBallpark({ rules: { pitchCount: '5' } })],
    ['an unknown difficulty', withBallpark({ rules: { difficulty: 'expert' } })],
    ['a ballpark theme that is not a style name', withBallpark({ theme: 'Garden Park' })],
    ['a ballpark color that is not #rrggbb', withBallpark({ colors: { roof: 'coral' } })],
    ['more than twelve ballpark colors', withBallpark({ colors: thirteenColors })],
    ['a ballpark color role that is not a style name', withBallpark({ colors: { 'Bad Role': '#e8735a' } })],
    ['a ballpark visibility sent as text', withBallpark({ visible: 'true' })],
    ['venues sent as a list', { ...firstSave, venues: [] }],
  ]
  for (const [label, body] of invalidCases) {
    assert((await save(body, admin.cookie)).status === 400, `${label} must be rejected`)
  }
  assert((await load()).status === 404, 'rejected saves store nothing')

  const saved = await save({ ...firstSave, objects: replaced(house, { internalNote: 'not stored' }) }, admin.cookie)
  assert(saved.status === 200, 'the admin can save the town')
  const savedTown = ((await saved.json()) as { town: { revision: number } }).town
  assert(savedTown.revision === 1, 'the first save becomes revision 1')

  const loaded = await load()
  type LoadedTown = {
    owner: Record<string, unknown>
    pet: Record<string, unknown>
    movement: unknown
    venues: unknown
    objects: Array<Record<string, unknown>>
    residents: Array<Record<string, unknown>>
  }
  const town = ((await loaded.json()) as { town: LoadedTown }).town
  assert(
    isDeepStrictEqual(town.movement, { gait: 'plantedFeet', skid: 'long' }),
    'a town saved without a movement setting walks the original way',
  )
  assert(
    isDeepStrictEqual(town.venues, { ballpark: { visible: false, theme: 'garden', colors: {}, rules: defaultRules } }),
    'a town saved without venues keeps the ballpark hidden, with the default look and rules',
  )
  assert(
    town.owner.introduction === null &&
      town.owner.contactEmail === null &&
      town.owner.linkedInProfileUrl === null &&
      town.owner.residentId === null &&
      isDeepStrictEqual(town.owner.questions, []) &&
      town.pet.route === null,
    "a town saved without an introduction, contact email, LinkedIn link, owner's resident or questions, or pet route reads them as null or empty",
  )
  const loadedHouse = town.objects.find(({ id }) => id === house.id)
  const loadedRoad = town.objects.find(({ id }) => id === road.id)
  assert(
    loadedHouse?.linkedInProfileUrl === 'https://www.linkedin.com/in/robin-sample' && !('internalNote' in loadedHouse),
    'house links are stored canonically and unknown fields are dropped',
  )
  assert(loadedRoad?.color === '#d7c79f', 'colors are stored in lowercase')
  assert(
    town.objects.find(({ id }) => id === 'cloud-0')?.color === null,
    'objects without a color keep the type default',
  )
  const loadedResident = town.residents[0]
  assert(
    JSON.stringify(loadedResident?.dialogue) === JSON.stringify(dialogue) &&
      JSON.stringify(loadedResident?.reference) === JSON.stringify(resident.reference) &&
      JSON.stringify(loadedResident?.role) === JSON.stringify(resident.role) &&
      loadedResident?.linkedInProfileUrl === 'https://www.linkedin.com/in/%EB%A9%94%EC%9D%B4%ED%94%8C-sample',
    'residents keep their role, canonical LinkedIn link, reference, and reviewed dialogue',
  )

  assert((await save(firstSave, admin.cookie)).status === 409, 'a save from a stale revision is refused')
  const introduction = { ko: '안녕하세요, 로빈이에요.\n천천히 둘러보세요.', en: "Hi, I'm Robin.\nTake your time." }
  const petRoute = [
    [6, 0],
    [0, 6],
    [-6, 0],
    [0, -6],
  ]
  const second = await save(
    {
      ...withResident({ role: undefined, relationship: null, linkedInProfileUrl: '', reference: null, dialogue: null }),
      owner: {
        ...firstSave.owner,
        introduction,
        contactEmail: ' Robin@Example.com ',
        linkedInProfileUrl: 'https://linkedin.com/in/robin-sample/',
        residentId: resident.id,
        questions: ownerQuestions,
      },
      pet: { ...firstSave.pet, route: petRoute },
      movement: { skid: 'off' },
      venues: { ballpark: { visible: true, theme: 'garden', colors: { roof: '#E8735A' } }, harbor: { theme: 'pier' } },
      baseRevision: 1,
    },
    admin.cookie,
  )
  assert(second.status === 200, 'a save from the current revision succeeds')
  const secondTown = ((await second.json()) as { town: LoadedTown }).town
  assert(
    isDeepStrictEqual(secondTown.movement, { gait: 'plantedFeet', skid: 'off' }),
    'a movement setting may leave out the gait',
  )
  assert(
    isDeepStrictEqual(secondTown.venues, {
      ballpark: { visible: true, theme: 'garden', colors: { roof: '#e8735a' }, rules: defaultRules },
    }),
    'a ballpark may leave out its rules, the admin shows it and its colors apply (in lowercase) in the same save, and unknown venues are dropped',
  )
  assert(
    isDeepStrictEqual(secondTown.owner, {
      ...firstSave.owner,
      introduction,
      contactEmail: 'robin@example.com',
      linkedInProfileUrl: 'https://www.linkedin.com/in/robin-sample',
      residentId: resident.id,
      questions: ownerQuestions,
    }) && isDeepStrictEqual(secondTown.pet, { ...firstSave.pet, route: petRoute }),
    "the owner's introduction, trimmed lowercase contact email, canonical LinkedIn link, resident without a reference or dialogue, five questions, and the pet's route are saved",
  )
  const secondResident = secondTown.residents[0]
  assert(
    secondResident?.role === null &&
      secondResident.relationship === null &&
      secondResident.linkedInProfileUrl === null &&
      secondResident.reference === null &&
      secondResident.dialogue === null,
    'a resident may have no texts or dialogue yet',
  )

  const source = {
    name: 'Maple',
    role: resident.role,
    relationship: resident.relationship,
    reference: resident.reference,
    owner: sampleTownLayout.owner.name,
  }
  function draft(body: unknown, cookie: string, draftApi = api) {
    return draftApi(
      new Request(`${origin}/v1/admin/resident-dialogues`, {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  }
  assert((await draft(source, member.cookie)).status === 403, 'only the admin drafts dialogue')
  assert(
    (await draft({ ...source, reference: { ko: '좋아요' } }, admin.cookie)).status === 400,
    'drafting needs the reference in both languages',
  )
  assert(
    (await draft({ ...source, owner: undefined }, admin.cookie)).status === 400,
    "drafting needs the owner's name, which the lines are about",
  )
  assert(sourcesSeen.length === 0, 'refused drafts never reach the LLM')
  assert((await draft(source, admin.cookie, apiWithoutLlm)).status === 503, 'drafting without OpenRouter says so')
  const drafted = await draft({ ...source, extra: 'not sent' }, admin.cookie)
  assert(drafted.status === 200, 'the admin can draft a resident dialogue')
  assert(
    JSON.stringify(((await drafted.json()) as { dialogue: unknown }).dialogue) === JSON.stringify(dialogue) &&
      JSON.stringify(sourcesSeen[0]) === JSON.stringify(source),
    "the draft is generated from only the name, role, relationship, reference, and owner's name",
  )
  await checkBallparkRuleSchedule(assert)
}

/** The ballpark rules change only between KST months, and the server decides which rules are in effect. */
async function checkBallparkRuleSchedule(assert: Assert): Promise<void> {
  const store = new MemoryStore()
  const service = new BackendService(store)
  const admin = { kind: 'linked', userId: 'schedule-admin', role: 'admin' } as const
  // 23:59:59 on December 31 in Seoul, which keeps no daylight saving time.
  const lastSecondOfDecember = Date.parse('2025-12-31T14:59:59Z')
  // Midnight on January 1 in Seoul, while UTC and the Americas are still in December.
  const firstSecondOfJanuary = Date.parse('2025-12-31T15:00:00Z')
  const january = { fromMonth: '2026-01', rules: { pitchCount: 7, difficulty: 'hard' } }
  const saveIn = (townService: BackendService, ballpark: Record<string, unknown>, baseRevision: number, now: number) =>
    townService.saveTown(admin, { ...sampleTownLayout, venues: { ballpark }, baseRevision }, now)
  const save = (ballpark: Record<string, unknown>, baseRevision: number, now: number) =>
    saveIn(service, ballpark, baseRevision, now)
  const refusalCode = (ballpark: Record<string, unknown>, baseRevision: number, now: number) =>
    save(ballpark, baseRevision, now).then(
      () => null,
      (error: unknown) => (error instanceof DomainError ? error.code : error),
    )

  assert(
    (await refusalCode(
      { scheduledRules: { ...january, rules: { pitchCount: 11, difficulty: 'hard' } } },
      0,
      lastSecondOfDecember,
    )) === 'INVALID_INPUT',
    'a schedule for the next KST month is still refused for a pitch count over ten',
  )
  const first = await save(
    { rules: { pitchCount: 9, difficulty: 'easy' }, scheduledRules: january },
    0,
    lastSecondOfDecember,
  )
  assert(
    isDeepStrictEqual(first.venues.ballpark.rules, defaultRules),
    'a town saved for the first time starts with the default rules, whatever rules it sends',
  )
  assert(
    isDeepStrictEqual(first.venues.ballpark.scheduledRules, january),
    'the last second of a KST month may still schedule the next month',
  )
  assert(
    (await refusalCode({ scheduledRules: { ...january, fromMonth: '2026-02' } }, 1, lastSecondOfDecember)) ===
      'INVALID_INPUT',
    'at the last second of a KST month, a device whose clock already reads the next month cannot move the schedule a month on',
  )
  const stale = await save(
    { rules: { pitchCount: 3, difficulty: 'easy' }, scheduledRules: january },
    1,
    lastSecondOfDecember,
  )
  assert(
    isDeepStrictEqual(stale.venues.ballpark.rules, defaultRules),
    'the rules a save sends, as a stale editor tab would, never change the rules in effect',
  )
  const api = createApi({ service, authStore: store, allowedOrigins: new Set([origin]), frontendUrl: origin })
  const read = await api(new Request(`${origin}/v1/town`))
  assert(
    isDeepStrictEqual(((await read.json()) as { town: { venues: { ballpark: unknown } } }).town.venues.ballpark, {
      visible: false,
      theme: 'garden',
      colors: {},
      rules: defaultRules,
      scheduledRules: january,
    }),
    'reads never check the clock: a stored schedule for 2026-01, a month the real clock has passed, still reads as saved',
  )
  // A save accepts only the next month, so the YYYY-MM shape now guards stored towns and seeds, read by this parse.
  const readRefusalCode = (fromMonth: string) => {
    try {
      parseTownVenues({ ballpark: { scheduledRules: { fromMonth, rules: defaultRules } } })
      return null
    } catch (error) {
      return error instanceof DomainError ? error.code : error
    }
  }
  for (const fromMonth of ['2026-1', '2026-13']) {
    assert(
      readRefusalCode(fromMonth) === 'INVALID_INPUT',
      `a stored schedule from ${fromMonth} is refused on read, since months compare as YYYY-MM text`,
    )
  }

  for (const scheduledRules of [
    { ...january, rules: { pitchCount: 4, difficulty: 'easy' } },
    { ...january, fromMonth: '2025-12' },
  ]) {
    assert(
      (await refusalCode({ scheduledRules }, 2, firstSecondOfJanuary)) === 'INVALID_INPUT',
      `from the first second of the KST month 2026-01, a changed schedule from ${scheduledRules.fromMonth} is refused`,
    )
  }
  const promoted = await save({ rules: defaultRules, scheduledRules: january }, 2, firstSecondOfJanuary)
  assert(
    isDeepStrictEqual(promoted.venues.ballpark.rules, january.rules) && !('scheduledRules' in promoted.venues.ballpark),
    'from the first second of its KST month, resending the stored schedule is accepted and promotes it into the rules',
  )
  assert(
    (await refusalCode({ scheduledRules: january }, 2, firstSecondOfJanuary)) === 'CONFLICT',
    'a tab that loaded the schedule before another tab promoted it is told the town changed, not that the month is wrong',
  )
  assert(
    (await refusalCode(
      { scheduledRules: { ...january, rules: { pitchCount: 4, difficulty: 'easy' } } },
      3,
      firstSecondOfJanuary,
    )) === 'INVALID_INPUT',
    'a town with no schedule cannot schedule the KST month already under way',
  )
  const afterPromotion = await save({ rules: { pitchCount: 3, difficulty: 'easy' } }, 3, firstSecondOfJanuary)
  assert(
    isDeepStrictEqual(afterPromotion.venues.ballpark.rules, january.rules),
    'once promoted, the rules stay in effect for the month, whatever rules a later save sends',
  )
  const february = { fromMonth: '2026-02', rules: { pitchCount: 4, difficulty: 'easy' } }
  const scheduledInJanuary = await save({ scheduledRules: february }, 4, firstSecondOfJanuary)
  assert(
    isDeepStrictEqual(scheduledInJanuary.venues.ballpark.scheduledRules, february),
    'from the first second of a KST month, the month after it may be scheduled',
  )

  // Two months ahead, as a server that let any later month be scheduled could have stored.
  const march = { fromMonth: '2026-03', rules: { pitchCount: 8, difficulty: 'hard' } }
  const earlierStore = new MemoryStore()
  await earlierStore.saveTown(
    parseTownLayout({ ...sampleTownLayout, venues: { ballpark: { scheduledRules: march } } }),
    0,
  )
  const resent = await saveIn(new BackendService(earlierStore), { scheduledRules: march }, 1, lastSecondOfDecember)
  assert(
    isDeepStrictEqual(resent.venues.ballpark.scheduledRules, march),
    'a stored schedule sent back unchanged is kept, even for a month a new schedule could not start in',
  )

  const unsent = new BackendService(new MemoryStore())
  await saveIn(unsent, { scheduledRules: january }, 0, lastSecondOfDecember)
  const promotedUnsent = await saveIn(unsent, {}, 1, firstSecondOfJanuary)
  assert(
    isDeepStrictEqual(promotedUnsent.venues.ballpark.rules, january.rules) &&
      !('scheduledRules' in promotedUnsent.venues.ballpark),
    'from the first second of its KST month, a save that leaves the schedule out still promotes it into the rules',
  )

  const cancelledTown = new BackendService(new MemoryStore())
  await saveIn(cancelledTown, { scheduledRules: january }, 0, lastSecondOfDecember)
  const cancelled = await saveIn(cancelledTown, {}, 1, lastSecondOfDecember)
  assert(
    !('scheduledRules' in cancelled.venues.ballpark),
    'before its KST month comes, a save that leaves the schedule out cancels it',
  )
}

function replaced(original: { id: string }, changes: Record<string, unknown>) {
  return sampleTownLayout.objects.map((object) => (object.id === original.id ? { ...object, ...changes } : object))
}
