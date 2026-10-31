import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYER_PROFILE } from '../../../data/playerProfile'
import { CONTACT_DEPTH, STRIKE_ZONE } from '../../game/field'
import { PLAYER_SCALE } from '../stageLayout'
import { BAT } from './bat'
import { createBatter, poseBatter } from './batter'
import { monotoneTrack, sampleTrack } from './keyframes'
import { sampleSwingPose, SWING_KEY_IDS, SWING_KEY_TIMES, SWING_KEYS } from './swingMotion'

const sides = ['right', 'left'] as const

function samplesBetween(times: number[], index: number) {
  return Array.from({ length: 49 }, (_, step) => times[index] + ((step + 1) / 50) * (times[index + 1] - times[index]))
}

function staysBetweenKeys(times: number[], values: number[]) {
  const track = monotoneTrack(times, values)
  return times.slice(1).every((_, index) => {
    const low = Math.min(values[index], values[index + 1]) - 1e-9
    const high = Math.max(values[index], values[index + 1]) + 1e-9
    return samplesBetween(times, index).every((time) => {
      const value = sampleTrack(track, time)
      return value >= low && value <= high
    })
  })
}

describe('monotone tracks', () => {
  it('never overshoot their keys, even into a sharp corner', () => {
    expect(staysBetweenKeys([0, 1, 2], [0, 0.1, 10])).toBe(true)
    expect(staysBetweenKeys([0, 0.2, 0.25, 1], [5, -3, 40, 41])).toBe(true)
  })

  it('carry every channel of the swing between its keys without overshooting', () => {
    const times = SWING_KEY_IDS.map((id) => SWING_KEY_TIMES[id])
    for (const values of Object.values(SWING_KEYS)) expect(staysBetweenKeys(times, values)).toBe(true)
  })
})

describe('the aimed swing', () => {
  it('puts the sweet spot on the game core contact point at the contact key, the bat square to the pitch', () => {
    for (const side of sides) {
      const batter = createBatter(DEFAULT_PLAYER_PROFILE, side)
      poseBatter(batter, sampleSwingPose(batter.motion, SWING_KEY_TIMES.contact))
      batter.rig.root.updateMatrixWorld(true)
      const sweetSpot = batter.bat.localToWorld(new Vector3(0, BAT.sweetSpot, 0))
      expect(sweetSpot.distanceTo(new Vector3(0, STRIKE_ZONE.center, -CONTACT_DEPTH))).toBeLessThan(0.001)
      const barrel = batter.bat.localToWorld(new Vector3(0, BAT.length, 0)).sub(sweetSpot)
      const offSquare = Math.atan2(Math.abs(barrel.z), Math.abs(barrel.x)) * (180 / Math.PI)
      expect(offSquare).toBeLessThan(15)
    }
  })

  it('squares the bat at the contact depth and height from its keys alone, the aim trimming only a few centimeters', () => {
    for (const side of sides) {
      const { x, y, z } = createBatter(DEFAULT_PLAYER_PROFILE, side).motion.aimOffset
      expect(Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) * PLAYER_SCALE).toBeLessThan(0.05)
    }
  })
})
