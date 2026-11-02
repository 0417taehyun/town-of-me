import { describe, expect, it } from 'vitest'
import type { PlayerProfile } from '../../data/playerProfile'
import { headFollowingBall } from '../../testing/castPlays'

// Batting left-handed; the right-handed side runs in a file of its own, side by side (see there for the looks): here a
// beanie over a bob, and a bob alone with pointed ears.
const HEAD_LOOKS: Partial<PlayerProfile>[] = [
  { hat: 'beanie', hair: 'bob' },
  { hat: 'none', hair: 'bob', ears: 'pointed' },
]

describe('the batter batting left-handed', () => {
  it.each(HEAD_LOOKS.map((look) => ({ look })))(
    'keeps the arms, the mittens, and the bat out of the head as its eyes follow the ball, smoothly: $look',
    ({ look }) => {
      const { depth, twitch } = headFollowingBall('left', look)
      expect(depth).toBeLessThan(0.001)
      expect(twitch).toBeLessThan(8)
    },
  )
})
