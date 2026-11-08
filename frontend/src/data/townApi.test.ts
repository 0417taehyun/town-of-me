import { describe, expect, it, vi } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { DEFAULT_TOWN_MOVEMENT, DEFAULT_TOWN_VENUES } from './models'
import {
  DialogueDraftError,
  draftResidentDialogue,
  fetchTownLayout,
  parseTownLayout,
  saveTownLayout,
  serializeTownLayout,
  TownSaveError,
} from './townApi'

const dialogue = {
  aboutOwner: { ko: '로빈은 먼저 만들어 봐요.', en: 'Robin builds first.' },
  followUps: [
    {
      question: { ko: '협업은 어때요?', en: 'What is Robin like to work with?' },
      answer: { ko: '같이 고민해 줘요.', en: 'Robin thinks problems through with you.' },
    },
  ],
}

const wireTown = (revision = 1) => ({ ...serializeTownLayout(SAMPLE_TOWN), revision })

const savedResponse = (revision = 3) => ({ town: { ...wireTown(revision), updatedAt: '2026-10-24T00:00:00.000Z' } })

const ballpark = {
  visible: true,
  theme: 'garden',
  colors: { roof: '#e8735a' },
  rules: { pitchCount: 7, difficulty: 'hard' },
  scheduledRules: { fromMonth: '2026-12', rules: { pitchCount: 3, difficulty: 'easy' } },
} as const

const withBallpark = (changes: Record<string, unknown>) =>
  parseTownLayout({ ...wireTown(), venues: { ballpark: { ...ballpark, ...changes } } }).venues.ballpark

describe('town layout API boundary', () => {
  it('round-trips every sample object, resident, and the owner and pet names through the save format', () => {
    expect(parseTownLayout(wireTown())).toEqual(SAMPLE_TOWN)
  })

  it("keeps a variant listed for the object's kind, drops any other, and leaves out kinds it cannot draw", () => {
    const layout = wireTown()
    const [tree, lamp] = ['tree-0', 'lamp-1'].map((id) => layout.objects.find((object) => object.id === id)!)
    const objects = [
      { ...tree, variant: 'leafy' },
      { ...tree, id: 'tree-rose', variant: 'rose' },
      { ...lamp, variant: 'neon' },
      { ...lamp, id: 'windmill-1', type: 'windmill', variant: 'tall' },
    ]
    const town = parseTownLayout({ ...layout, objects: [...layout.objects, ...objects] })
    const [leafy, rose, neon] = town.objects.slice(SAMPLE_TOWN.objects.length)
    expect(town.objects).toHaveLength(SAMPLE_TOWN.objects.length + 3)
    expect(leafy).toMatchObject({ id: 'tree-0', type: 'tree', variant: 'leafy' })
    expect(rose).toMatchObject({ id: 'tree-rose', type: 'tree' })
    expect(rose.variant).toBeUndefined()
    expect(neon).toMatchObject({ id: 'lamp-1', type: 'lamp' })
    expect(neon.variant).toBeUndefined()
    const resaved = parseTownLayout({ ...serializeTownLayout(town), revision: 1 })
    expect(resaved).toEqual(town)
  })

  it('requires the owner and the pet to be named in both languages', () => {
    expect(() => parseTownLayout({ ...wireTown(), owner: undefined })).toThrow('town.owner')
    expect(() => parseTownLayout({ ...wireTown(), pet: { name: { ko: '토토', en: ' ' } } })).toThrow('town.pet.name.en')
  })

  it('drops a contact email or pet route it cannot use, reads omitted ones as none, and round-trips valid ones', () => {
    const layout = wireTown()
    const route = [
      [-4, 0],
      [10.5, -2],
      [0, 12],
    ]
    const town = parseTownLayout({
      ...layout,
      owner: {
        ...layout.owner,
        contactEmail: ' Robin@Example.com ',
        linkedInProfileUrl: 'https://linkedin.com/in/robin-sample/',
      },
      pet: { ...layout.pet, route },
    })
    expect(town.owner.contactEmail).toBe('robin@example.com')
    expect(town.owner.linkedInProfileUrl).toBe('https://www.linkedin.com/in/robin-sample')
    expect(town.pet.route).toEqual(route)
    expect(parseTownLayout({ ...serializeTownLayout(town), revision: 1 })).toEqual(town)
    const emails = ['robin', 'robin@example', 'ro bin@example.com', `${'r'.repeat(250)}@example.com`, 42]
    const routes = [route.slice(0, 2), [...route, [60, 0]], [...route, [2, '3']], 'loop']
    const withEmail = (contactEmail: unknown) =>
      parseTownLayout({ ...layout, owner: { ...layout.owner, contactEmail } })
    const withRoute = (petRoute: unknown) => parseTownLayout({ ...layout, pet: { ...layout.pet, route: petRoute } })
    expect(emails.map((email) => withEmail(email).owner.contactEmail)).toEqual(emails.map(() => null))
    expect(routes.map((petRoute) => withRoute(petRoute).pet.route)).toEqual(routes.map(() => null))
    const omitted = parseTownLayout({ ...layout, owner: { name: layout.owner.name }, pet: { name: layout.pet.name } })
    expect(omitted.owner).toMatchObject({ introduction: null, contactEmail: null, linkedInProfileUrl: null })
    expect(omitted.pet.route).toBeNull()
  })

  it('sends a blank introduction and contact email as none, since the backend rejects empty text', () => {
    const owner = { ...SAMPLE_TOWN.owner, introduction: { ko: ' ', en: '' }, contactEmail: ' ' }
    expect(serializeTownLayout({ ...SAMPLE_TOWN, owner }).owner).toMatchObject({
      name: SAMPLE_TOWN.owner.name,
      introduction: null,
      contactEmail: null,
    })
  })

  it("round-trips the owner's resident and questions, and drops a resident the town does not have", () => {
    const layout = wireTown()
    const owner = parseTownLayout(layout).owner
    expect(owner.residentId).not.toBeNull()
    expect(owner.questions).not.toEqual([])
    expect(owner).toEqual(SAMPLE_TOWN.owner)
    const residents = layout.residents.filter(({ id }) => id !== owner.residentId)
    expect(parseTownLayout({ ...layout, residents }).owner.residentId).toBeNull()
    const omitted = parseTownLayout({ ...layout, owner: { name: layout.owner.name } }).owner
    expect(omitted).toMatchObject({ residentId: null, questions: [] })
  })

  it('sends residents as appearance only, never visitor identity fields', () => {
    const [resident] = serializeTownLayout(SAMPLE_TOWN).residents
    expect(resident.appearance).toMatchObject({ hair: 'curls', colors: { skin: '#8c5d43' } })
    expect(resident.appearance).not.toHaveProperty('genderIdentity')
    expect(resident.appearance).not.toHaveProperty('linkedInProfileUrl')
    expect(resident).not.toHaveProperty('profile')
  })

  it('keeps the chosen movement styles and falls back to the defaults for missing or unknown ones', () => {
    const chosen = { gait: 'keyPoses', skid: 'off' } as const
    expect(parseTownLayout({ ...wireTown(), movement: chosen }).movement).toEqual(chosen)
    expect(parseTownLayout({ ...wireTown(), movement: undefined }).movement).toEqual(DEFAULT_TOWN_MOVEMENT)
    expect(parseTownLayout({ ...wireTown(), movement: { gait: 'moonwalk', skid: 'short' } }).movement).toEqual({
      gait: DEFAULT_TOWN_MOVEMENT.gait,
      skid: 'short',
    })
  })

  it('round-trips whether the ballpark is shown, its look, rules, and scheduled rules, so an admin save keeps them', () => {
    const town = parseTownLayout({ ...wireTown(), venues: { ballpark } })
    expect(town.venues.ballpark).toEqual(ballpark)
    expect(parseTownLayout({ ...serializeTownLayout(town), revision: 1 })).toEqual(town)
    expect(parseTownLayout({ ...wireTown(), venues: undefined }).venues).toEqual(DEFAULT_TOWN_VENUES)
  })

  it('keeps the ballpark hidden unless the town shows it, also in a town saved before the switch existed', () => {
    const visibility = [undefined, null, 'true', 1, false, true].map((visible) => withBallpark({ visible }).visible)
    expect(visibility).toEqual([false, false, false, false, false, true])
    expect(parseTownLayout({ ...wireTown(), venues: undefined }).venues.ballpark.visible).toBe(false)
  })

  it('falls back to the default theme, difficulty, or pitch count for values this build lacks', () => {
    expect(withBallpark({ theme: 'harvest' }).theme).toBe('garden')
    const pitchCounts = [2, 3, 10, 11, 4.5, 12, '7']
    const rules = pitchCounts.map((pitchCount) => withBallpark({ rules: { pitchCount, difficulty: 'expert' } }).rules)
    expect(rules.map(({ pitchCount }) => pitchCount)).toEqual([5, 3, 10, 5, 5, 5, 5])
    expect(rules.map(({ difficulty }) => difficulty)).toEqual(pitchCounts.map(() => 'normal'))
    expect(withBallpark({ rules: { difficulty: 'easy' } }).rules).toEqual({ pitchCount: 5, difficulty: 'easy' })
  })

  it('drops color overrides for roles the ballpark lacks or that are not #rrggbb, keeping the valid ones', () => {
    const colors = { roof: '#e8735a', hedge: '#2f5d50', trim: 'coral', walls: 42, accent: '#F2C14E' }
    expect(withBallpark({ colors }).colors).toEqual({ roof: '#e8735a', accent: '#F2C14E' })
  })

  it('drops a schedule without a YYYY-MM month and keeps the rules in effect', () => {
    const schedules = [{ ...ballpark.scheduledRules, fromMonth: '2026-13' }, { rules: ballpark.rules }, '2026-12', null]
    const parsed = schedules.map((scheduledRules) => withBallpark({ scheduledRules }))
    expect(parsed.map((settings) => settings.scheduledRules)).toEqual(schedules.map(() => undefined))
    expect(parsed.map((settings) => settings.rules)).toEqual(schedules.map(() => ballpark.rules))
  })

  it('rejects resident motion data that references an unknown bench', () => {
    const layout = wireTown()
    layout.residents[0] = { ...layout.residents[0], benchId: 'missing-bench' }
    expect(() => parseTownLayout(layout)).toThrow('Resident maple references an unknown bench')
  })

  it('loads the saved town, and fails instead of falling back to a built-in town when it is missing', async () => {
    const request = vi.fn(async () => Response.json(savedResponse()))
    const town = await fetchTownLayout(request as typeof fetch)
    expect(request).toHaveBeenCalledWith('/v1/town', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    expect(town.revision).toBe(3)
    const missing = vi.fn(async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }))
    await expect(fetchTownLayout(missing as typeof fetch)).rejects.toThrow('404')
    const unreachable = vi.fn(async () => new Response('Bad gateway', { status: 502 }))
    await expect(fetchTownLayout(unreachable as typeof fetch)).rejects.toThrow('502')
  })

  it('saves from the loaded revision and surfaces conflicts with their status', async () => {
    const request = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { baseRevision: number }
      return body.baseRevision === 3
        ? Response.json(savedResponse(4))
        : Response.json({ error: { code: 'CONFLICT' } }, { status: 409 })
    })
    const saved = await saveTownLayout({ ...SAMPLE_TOWN, revision: 3 }, request as typeof fetch)
    expect(saved.revision).toBe(4)
    expect(request.mock.calls[0][0]).toBe('/v1/admin/town')
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'PUT', credentials: 'same-origin' })
    await expect(saveTownLayout({ ...SAMPLE_TOWN, revision: 1 }, request as typeof fetch)).rejects.toEqual(
      new TownSaveError(409),
    )
  })

  it('keeps resident profiles and dialogue, and sends texts left blank in both languages as not written', () => {
    const [first, second, ...rest] = SAMPLE_TOWN.residents
    const town = {
      ...SAMPLE_TOWN,
      residents: [
        { ...first, dialogue },
        { ...second, role: { ko: ' ', en: '' }, linkedInProfileUrl: '', dialogue: null },
        ...rest,
      ],
    }
    const [sentFirst, sentSecond] = serializeTownLayout(town).residents
    expect(sentFirst.role).toEqual(first.role)
    expect(sentSecond.role).toBeNull()
    expect(sentSecond.linkedInProfileUrl).toBeNull()
    expect(sentSecond.dialogue).toBeNull()
    const loaded = parseTownLayout({ ...serializeTownLayout(town), revision: 2 })
    expect(loaded.residents[0]).toMatchObject({ dialogue, relationship: first.relationship })
    expect(loaded.residents[1]).toMatchObject({ role: { ko: '', en: '' }, dialogue: null })
    expect(loaded.residents[1].linkedInProfileUrl).toBeUndefined()
    expect(() =>
      parseTownLayout({
        ...serializeTownLayout(town),
        revision: 2,
        residents: [{ ...sentFirst, dialogue: { ...dialogue, aboutOwner: { ko: '좋아요' } } }],
      }),
    ).toThrow('aboutOwner.en')
  })

  it('drafts a resident dialogue about the named owner, and reports why a draft failed', async () => {
    const resident = {
      name: 'Juno',
      role: { ko: '마을 정원사', en: 'Town gardener' },
      relationship: { ko: '', en: '' },
      reference: { ko: '좋은 이웃이에요.', en: 'A great neighbor.' },
    }
    const owner = SAMPLE_TOWN.owner.name
    const request = vi.fn(async () => Response.json({ dialogue }))
    expect(await draftResidentDialogue(resident, owner, request as typeof fetch)).toEqual(dialogue)
    const { name, role, reference } = resident
    expect(request).toHaveBeenCalledWith(
      '/v1/admin/resident-dialogues',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ name, owner, role, relationship: null, reference }),
      }),
    )
    const unavailable = vi.fn(async () =>
      Response.json({ error: { code: 'NOT_CONFIGURED', message: 'Set OPENROUTER_API_KEY' } }, { status: 503 }),
    )
    await expect(draftResidentDialogue(resident, owner, unavailable as typeof fetch)).rejects.toEqual(
      new DialogueDraftError(503, 'Set OPENROUTER_API_KEY'),
    )
  })
})
