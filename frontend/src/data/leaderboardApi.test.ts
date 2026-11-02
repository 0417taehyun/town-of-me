import { describe, expect, it, vi } from 'vitest'
import type { DerbyInputLog } from '../baseball/game/derbyScore'
import { rankedRunBody, submitRankedRun, updateOwnRecord } from './leaderboardApi'
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
})
