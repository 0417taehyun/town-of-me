import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { begunScenarios, gridScenarios, LOOKS, worstOf } from '../../../testing/batterSwings'
import { createBatter } from './batter'

// Batting left-handed; the right-handed side runs in a file of its own, side by side (see there for the looks).

/** How deep anything may sink into anything (m): a millimeter, the measure's own tolerance. */
const TOLERANCE = 0.001
/** How much longer than its bone an upper arm may be drawn: soft IK's own at an arm's full reach (twoBoneIk.ts). */
const STRETCH = 0.03

/** none/crop, none/bob, beanie/none, sunhat/bob (LOOKS). */
const LOOK_INDICES = [0, 2, 11, 14]

describe('batting left-handed', () => {
  it.each(LOOK_INDICES.map((lookIndex) => ({ look: LOOKS[lookIndex] })))(
    'keeps its bat, arms, and mittens out of its body and each other, wearing $look',
    ({ look }) => {
      const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, 'left')
      for (const scenario of gridScenarios('left')) {
        const worst = worstOf(batter, scenario)
        expect(worst.depth, worst.where).toBeLessThan(TOLERANCE)
        expect(worst.stretch, worst.stretchedAt).toBeLessThan(STRETCH)
      }
    },
  )

  it('keeps them so through swings the camera saw begin, checked, and judged on their way, wearing the default', () => {
    const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...LOOKS[0] }, 'left')
    for (const scenario of begunScenarios('left')) {
      const worst = worstOf(batter, scenario)
      expect(worst.depth, worst.where).toBeLessThan(TOLERANCE)
      expect(worst.stretch, worst.stretchedAt).toBeLessThan(STRETCH)
    }
  })
})
