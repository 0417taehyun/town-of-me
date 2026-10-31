import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../../data/playerProfile'

// The other team's uniform: brick red tops with charcoal caps, trousers, and shoes, against the cream and navy of ours.
// The visitor bats in their own town clothes; the pitcher and catcher wear this over faces of their own, all fictional.

export type TeamUniform = { cap: string; top: string; bottom: string; shoes: string }

export const AWAY_UNIFORM: TeamUniform = { cap: '#2f2b2a', top: '#b0503f', bottom: '#3a3533', shoes: '#2f2b2a' }

/** `player` in a cap, tee, trousers, and sneakers in `uniform`'s colors, keeping their own face, hair, and skin. */
export function wearUniform(player: PlayerProfile, uniform: TeamUniform): PlayerProfile {
  return {
    ...player,
    hat: 'cap',
    top: 'tee',
    bottom: 'trousers',
    shoes: 'sneakers',
    colors: { ...player.colors, hat: uniform.cap, top: uniform.top, bottom: uniform.bottom, shoes: uniform.shoes },
  }
}

/** A fictional player named `name` with this hair style, skin, and hair color. */
export function opponent(name: string, hair: PlayerProfile['hair'], skin: string, hairColor: string): PlayerProfile {
  const colors = { ...DEFAULT_PLAYER_PROFILE.colors, skin, hair: hairColor }
  return wearUniform({ ...DEFAULT_PLAYER_PROFILE, name, hair, colors }, AWAY_UNIFORM)
}

export const PITCHER_PROFILE = opponent('Pitcher', 'crop', '#e9ba99', '#272525')
export const CATCHER_PROFILE = opponent('Catcher', 'curls', '#8c5d43', '#503a2e')
