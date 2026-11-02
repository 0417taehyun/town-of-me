import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { begunScenarios, gridScenarios, LOOKS, worstOf } from '../../../testing/batterSwings'
import { createBatter } from './batter'

// Batting right-handed; the left-handed side runs in a file of its own, side by side. Together the two sides wear every
// hat, every hair, and every other option at least once: no hat over a crop (the default), the plain bob, whose side
// hair the arms come nearest, and the sun hat over a bob, the widest head, on both sides, and a cap and a beanie on one.

/** How deep anything may sink into anything (m): a millimeter, the measure's own tolerance. */
const TOLERANCE = 0.001
/** How much longer than its bone an upper arm may be drawn: soft IK's own at an arm's full reach (twoBoneIk.ts). */
const STRETCH = 0.03

/** none/crop, none/bob, cap/curls, sunhat/bob (LOOKS). */
const LOOK_INDICES = [0, 2, 5, 14]

describe('batting right-handed', () => {
  it.each(LOOK_INDICES.map((lookIndex) => ({ look: LOOKS[lookIndex] })))(
    'keeps its bat, arms, and mittens out of its body and each other, wearing $look',
    ({ look }) => {
      const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...look }, 'right')
      for (const scenario of gridScenarios('right')) {
        const worst = worstOf(batter, scenario)
        expect(worst.depth, worst.where).toBeLessThan(TOLERANCE)
        expect(worst.stretch, worst.stretchedAt).toBeLessThan(STRETCH)
      }
    },
  )

  it('keeps them so through swings the camera saw begin, checked, and judged on their way, wearing a plain bob', () => {
    const batter = createBatter({ ...DEFAULT_PLAYER_PROFILE, ...LOOKS[2] }, 'right')
    for (const scenario of begunScenarios('right')) {
      const worst = worstOf(batter, scenario)
      expect(worst.depth, worst.where).toBeLessThan(TOLERANCE)
      expect(worst.stretch, worst.stretchedAt).toBeLessThan(STRETCH)
    }
  })
})
