import { describe, expect, it, vi } from 'vitest'
import type { DerbyInputLog } from '../baseball/game/derbyScore'
import { fetchBoard, fetchPodium, rankedRunBody, submitRankedRun, updateOwnRecord } from './leaderboardApi'
import { appearanceFields, DEFAULT_PLAYER_PROFILE, type PlayerProfile } from './playerProfile'

const visitor: PlayerProfile = {
  ...DEFAULT_PLAYER_PROFILE,
  name: 'Pip',
  hair: 'bob',
  genderIdentity: 'self-described',
  genderDescription: 'Gardener',
  linkedInProfileUrl: 'https://www.linkedin.com/in/example-pip',
}
const swing = { contactMs: 1137.8238636363637, startedMs: 906.3238636363637, speed: 9.11, heightError: null }
// A log entry may carry more than the judge reads, such as what the tracker saw; none of it may leave the device.
const log = {
  side: 'left',
  practice: [{ errorMs: 96.4, speed: 8.1, keypoints: [[0.4, 0.5]] }],
  swings: [{ ...swing, keypoints: [[0.4, 0.5]], trace: [1, 2, 3] }, null],
} as unknown as DerbyInputLog
const outcome = {
  result: { homeRuns: 1, totalDistanceDm: 1232, pitches: [] },
  standing: { kind: 'unlisted', wouldBeRank: 4, personalBest: true },
  entry: null,
}
const ownEntry = {
  listed: true,
  name: 'Pip',
  nameStatus: 'pending',
  takedown: false,
  linkedIn: null,
  homeRuns: 1,
  totalDistanceDm: 1232,
  rank: 4,
}

function sentBody(request: { mock: { calls: Parameters<typeof fetch>[] } }, call = 0) {
  const [, init] = request.mock.calls[call]
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

describe('leaderboard API boundary', () => {
  it('sends a run’s result as its log numbers, its claimed totals, and the look and board name only', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(outcome))
    const body = rankedRunBody(log, { homeRuns: 1, homeRunDistanceDecimetres: 1232 }, 31840, visitor, 'Pip')
    await submitRankedRun('run-7', body, request)
    expect(request.mock.calls[0][0]).toBe('/v1/games/home-run-derby/runs/run-7/result')
    const sent = sentBody(request)
    expect(Object.keys(sent).sort()).toEqual(['claimed', 'clientElapsedMs', 'practice', 'profile', 'side', 'swings'])
    expect(sent.practice).toEqual([{ errorMs: 96.4, speed: 8.1 }])
    // Unrounded, so the server replays exactly the numbers the screen's result came from.
    expect(sent.swings).toEqual([swing, null])
    expect(sent.claimed).toEqual({ homeRuns: 1, totalDistanceDm: 1232 })
    expect(Object.keys(sent.profile as object).sort()).toEqual(['colors', 'name', ...appearanceFields].sort())
    expect(sent.profile).toMatchObject({ name: 'Pip', hair: 'bob' })
  })

  it('leaves out a name the board would refuse, so the result is still recorded, and sends it as the board keeps it', () => {
    const totals = { homeRuns: 0, homeRunDistanceDecimetres: 0 }
    // Thirteen ㎞ are 13 characters as typed but 26 once NFKC spells each out as "km".
    const widened = rankedRunBody(log, totals, 0, visitor, '㎞'.repeat(13))
    expect(widened.profile).not.toHaveProperty('name')
    expect(rankedRunBody(log, totals, 0, visitor, 'Pip\u0007').profile).not.toHaveProperty('name')
    expect(rankedRunBody(log, totals, 0, visitor, '  Ｐｉｐ   Two ').profile).toMatchObject({ name: 'Pip Two' })
  })

  it('lists with the character and name only, and sends a LinkedIn link only when the visitor turned it on', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ entry: ownEntry }))
    const listed = { listed: true as const, profile: visitor, name: 'Pip' }
    await updateOwnRecord({ ...listed, linkedIn: undefined }, request)
    await updateOwnRecord({ ...listed, linkedIn: visitor.linkedInProfileUrl }, request)
    await updateOwnRecord({ ...listed, name: null, linkedIn: null }, request)
    await updateOwnRecord({ listed: false }, request)
    const [plain, linked, anonymous, unlisted] = [0, 1, 2, 3].map((call) => sentBody(request, call))
    expect(plain).not.toHaveProperty('linkedIn')
    expect(plain.profile).not.toHaveProperty('linkedInProfileUrl')
    expect(plain.profile).not.toHaveProperty('genderIdentity')
    expect(linked.linkedIn).toEqual({ profileUrl: visitor.linkedInProfileUrl, ownProfile: true })
    expect(anonymous.linkedIn).toBe(null)
    expect(anonymous.profile).not.toHaveProperty('name')
    expect(unlisted).toEqual({ listed: false })
  })

  it('reads a board row by row: looks normalized, names only once approved, links only on statues, bad rows dropped', async () => {
    const row = (rank: number, fields: Record<string, unknown> = {}) => ({
      id: `entry-${rank}`,
      rank,
      name: null,
      nameState: 'reviewing',
      profile: { hair: 'crop', colors: { top: '#6f987c' } },
      homeRuns: 4,
      totalDistanceDm: 5117,
      achievedOn: '2026-11-02',
      ...fields,
    })
    const payload = {
      season: { id: '2026-11', startsAt: '2026-10-31T15:00:00.000Z', endsAt: '2026-11-30T15:00:00.000Z', final: false },
      podium: [
        row(1, {
          name: 'Momo',
          nameState: 'approved',
          profile: { hair: 'bob', colors: { top: '#CA7765', hair: 'red' } },
          linkedInProfileUrl: 'https://www.linkedin.com/in/example-momo',
        }),
        row(2, { name: 'Not yet', linkedInProfileUrl: 'https://link.example/in/example-pip' }),
        row(3, { homeRuns: -1 }),
      ],
      // Fourth and fifth tie on home runs and distance; the server ranks the earlier record first, whatever the order.
      ranks: [
        row(5, { achievedOn: '2026-11-09' }),
        row(4, { achievedOn: '2026-11-03', nameState: 'anonymous', profile: { kind: 'default' } }),
        { rank: 6 },
        row(7, { linkedInProfileUrl: 'https://www.linkedin.com/in/example-pip' }),
      ],
      own: null,
    }
    const request = vi.fn<typeof fetch>(async () => Response.json(payload))
    const board = await fetchBoard('2026-11', request)
    expect(request.mock.calls[0][0]).toBe('/v1/games/home-run-derby/leaderboard?season=2026-11')
    const [champion, second] = board.podium
    expect(board.podium.map(({ rank }) => rank)).toEqual([1, 2])
    expect(champion.profile).toMatchObject({
      hair: 'bob',
      colors: { top: '#ca7765', hair: DEFAULT_PLAYER_PROFILE.colors.hair },
    })
    expect([champion.name, second.name]).toEqual(['Momo', null])
    expect([champion.linkedInProfileUrl, second.linkedInProfileUrl]).toEqual([
      'https://www.linkedin.com/in/example-momo',
      null,
    ])
    expect(board.ranks.map(({ id }) => id)).toEqual(['entry-4', 'entry-5', 'entry-7'])
    expect(board.ranks[0].profile).toBe(null)
    expect(board.ranks[2].linkedInProfileUrl).toBe(null)
  })

  it('reads the town’s statues without the visitor cookie, one per place, and refuses an answer it cannot place', async () => {
    const row = (rank: number, fields: Record<string, unknown> = {}) => ({
      id: `entry-${rank}`,
      rank,
      name: null,
      nameState: 'anonymous',
      profile: { kind: 'default' },
      homeRuns: 3,
      totalDistanceDm: 3601,
      achievedOn: '2026-11-02',
      ...fields,
    })
    const podium = [
      row(1, { name: 'Momo', nameState: 'approved', linkedInProfileUrl: 'https://www.linkedin.com/in/example-momo' }),
      row(1, { id: 'entry-again', name: 'Twice', nameState: 'approved' }),
      row(2, { linkedInProfileUrl: 'https://www.linkedin.com.example/in/example-pip' }),
      row(3, { profile: null }),
      row(4),
    ]
    const request = vi.fn<typeof fetch>(async () => Response.json({ season: { id: '2026-11' }, podium }))
    const read = await fetchPodium(false, request)
    expect(request.mock.calls[0][0]).toBe('/v1/games/home-run-derby/podium')
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
    expect(read.season).toBe('2026-11')
    expect(read.rows.map(({ id }) => id)).toEqual(['entry-1', 'entry-2'])
    expect(read.rows.map(({ linkedInProfileUrl }) => linkedInProfileUrl)).toEqual([
      'https://www.linkedin.com/in/example-momo',
      null,
    ])

    const unplaced = vi.fn<typeof fetch>(async () => Response.json({ season: { id: 'November' }, podium }))
    await expect(fetchPodium(true, unplaced)).rejects.toThrow()
  })
})
