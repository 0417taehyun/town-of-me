import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { LOOKS, lookScenarios, worstOf } from '../../../testing/batterSwings'
import { createBatter } from './batter'

// Half the looks batting right-handed; the other half and the other side run in files of their own, side by side.

/** How deep anything may sink into anything (m): a millimeter, the measure's own tolerance. */
const TOLERANCE = 0.001
/** How much longer than its bone an upper arm may be drawn: soft IK's own at an arm's full reach (twoBoneIk.ts). */
const STRETCH = 0.03

describe('batting right-handed', () => {
  it.each(LOOKS.slice(8, 16).map((look, index) => ({ look, lookIndex: 8 + index })))(
    'keeps its bat, arms, and mittens out of its body and each other, wearing $look',
    ({ look, lookIndex }) => {
      const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, 'right')
      for (const scenario of lookScenarios(lookIndex, 'right')) {
        const worst = worstOf(batter, scenario)
        expect(worst.depth, worst.where).toBeLessThan(TOLERANCE)
        expect(worst.stretch, worst.stretchedAt).toBeLessThan(STRETCH)
      }
    },
  )
})
