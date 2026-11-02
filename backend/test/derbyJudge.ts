import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { type DerbyInputLog, replayDerby } from '../src/derbyJudge/derbyScore.js'
import { createRunPlan } from '../src/derbyJudge/runPlan.js'
import type { BallparkRules } from '../src/index.js'

type Assert = (condition: unknown, message: string) => asserts condition

/** A fictional run and how the frontend judge scored it (the file's `about` says which commit). */
interface GoldenVector {
  name: string
  rules: BallparkRules
  seed: number
  log: DerbyInputLog
  expected: unknown
}

const vectorsFile = new URL('../../test/derbyJudgeVectors.json', import.meta.url)

export async function checkDerbyJudge(assert: Assert) {
  const { vectors } = JSON.parse(await readFile(vectorsFile, 'utf8')) as { vectors: GoldenVector[] }
  assert(vectors.length > 0, 'the golden vectors load')
  for (const vector of vectors) {
    const { plan, ...scores } = replayDerby(createRunPlan(vector.rules, vector.seed), vector.log)
    // Through JSON like the vectors themselves, which write a left-handed dead-on spray of -0 as 0.
    const scored: unknown = JSON.parse(JSON.stringify({ schedule: plan.schedule, ...scores }))
    assert(isDeepStrictEqual(scored, vector.expected), `${vector.name}: the backend judge must score as the frontend`)
  }
}
