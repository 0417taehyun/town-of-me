import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../../data/playerProfile'

// The other team's uniform: brick red tops with charcoal caps, trousers, and shoes, against the cream and navy of ours.
// The visitor bats in their own town clothes; the other players wear their team's over faces of their own, the
// pitcher's and catcher's fictional, the rest the town's visitors' (stadium/guestLooks.ts). Each team wears its emblem
// on the chest (teamEmblem.ts): a brick star on cream for them, a cream garden flower on navy for us.

export type TeamEmblem = { badgeColor: string; markColor: string; mark: 'star' | 'flower' }

export type TeamUniform = { cap: string; top: string; bottom: string; shoes: string; emblem?: TeamEmblem }

export const AWAY_UNIFORM: TeamUniform = {
  cap: '#2f2b2a',
  top: '#b0503f',
  bottom: '#3a3533',
  shoes: '#2f2b2a',
  emblem: { badgeColor: '#f4efe2', markColor: '#b0503f', mark: 'star' },
}
/** Our team's: cream tops and trousers under navy caps and shoes. */
export const HOME_UNIFORM: TeamUniform = {
  cap: '#374b65',
  top: '#f4efe2',
  bottom: '#f4efe2',
  shoes: '#374b65',
  emblem: { badgeColor: '#374b65', markColor: '#f4efe2', mark: 'flower' },
}
/** The umpire's: a navy shirt, grey trousers, and a charcoal cap and shoes. */
export const UMPIRE_UNIFORM: TeamUniform = { cap: '#272525', top: '#374b65', bottom: '#5f6670', shoes: '#272525' }

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
