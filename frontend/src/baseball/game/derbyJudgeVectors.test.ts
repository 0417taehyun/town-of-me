import { describe, expect, it } from 'vitest'
import type { BallparkRules } from '../../data/models'
import { type DerbyInputLog, replayDerby } from './derbyScore'
import vectorsFile from './derbyJudgeVectors.json'
import { createRunPlan } from './runPlan'

// derbyJudgeVectors.json is an exact copy of backend/test/derbyJudgeVectors.json, the fictional runs the server's
// judge (backend/src/derbyJudge/) is held to. A ranked run's result is the server's, so a change here that scores any
// of them differently would show the visitor a result the board does not keep.

type GoldenVector = { name: string; rules: BallparkRules; seed: number; log: DerbyInputLog; expected: unknown }

/** Launch angles only draw the flight, so the vectors leave them out. */
const withoutLaunchAngles = (key: string, value: unknown) => (key === 'launchDegrees' ? undefined : value)

describe('derby judge golden vectors', () => {
  it('scores every run of the server’s vectors exactly as the server’s judge does', () => {
    const { vectors } = vectorsFile as { vectors: GoldenVector[] }
    expect(vectors.length).toBeGreaterThan(0)
    for (const vector of vectors) {
      const { plan, ...scores } = replayDerby(createRunPlan(vector.rules, vector.seed), vector.log)
      // Through JSON like the vectors themselves, which write a left-handed dead-on spray of -0 as 0.
      const scored: unknown = JSON.parse(JSON.stringify({ schedule: plan.schedule, ...scores }, withoutLaunchAngles))
      expect(scored, vector.name).toEqual(vector.expected)
    }
  })
})
