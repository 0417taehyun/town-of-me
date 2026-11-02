import { describe, expect, it } from 'vitest'
import type { PlayerProfile } from '../../data/playerProfile'
import { headFollowingBall } from '../../testing/castPlays'

// Batting right-handed; the left-handed side runs in a file of its own, side by side, and the rest of the cast in
// ballplayerCast.test.ts. The looks whose brim or hair comes nearest the bat, the shoulders, and the hands bat once
// each, the sides taking turns: here a cap and a sun hat over a crop.
const HEAD_LOOKS: Partial<PlayerProfile>[] = [
  { hat: 'cap', hair: 'crop' },
  { hat: 'sunhat', hair: 'crop' },
]

describe('the batter batting right-handed', () => {
  it.each(HEAD_LOOKS.map((look) => ({ look })))(
    'keeps the arms, the mittens, and the bat out of the head as its eyes follow the ball, smoothly: $look',
    ({ look }) => {
      const { depth, twitch } = headFollowingBall('right', look)
      expect(depth).toBeLessThan(0.001)
      expect(twitch).toBeLessThan(8)
    },
  )
})
