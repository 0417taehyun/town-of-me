import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { shoulderPoint } from './ballplayerRig'
import { createBatter } from './batter'
import { searchSwivel, smoothestSwivel, SWIVEL } from './mittenHands'

describe('the elbow swivel search', () => {
  // The search takes the trial nearest smoothestSwivel for the grid's best whenever that trial is clear, so the two
  // must agree on where its cost is lowest while nothing is in the way.
  it('settles on the smoothest swivel when nothing is in the arm’s way', () => {
    const { rig } = createBatter(DEFAULT_PLAYER_PROFILE, 'right')
    const center = shoulderPoint(rig, 0, new Vector3()).add(new Vector3(0.2, -0.3, 0.3))
    const farBat = { knob: new Vector3(0, 0, 50), axis: new Vector3(1, 0, 0) }
    const pole = new Vector3(0, -1, 0)
    const runs = [
      [{ swivel: 20, change: 15 }],
      [
        { swivel: 20, change: 15 },
        { swivel: 35, change: 30 },
      ],
      [
        { swivel: -50, change: 15 },
        { swivel: -10, change: 15 },
      ],
    ]
    for (const neighbours of runs) {
      const searched = searchSwivel(rig, 0, center, farBat, pole, neighbours, [])
      expect(searched).toBeCloseTo(smoothestSwivel(neighbours, SWIVEL.weight), 6)
    }
  })
})
