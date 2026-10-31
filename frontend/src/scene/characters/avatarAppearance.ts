import type { Vector3Tuple } from 'three'
import type { PlayerProfile } from '../../data/playerProfile'

export type AvatarPart = {
  id: string
  shape: 'box' | 'sphere' | 'cone' | 'cylinder' | 'arc'
  position: Vector3Tuple
  scale: Vector3Tuple
  color: string
  rotation?: Vector3Tuple
}

const ink = '#352b29'

export function avatarPart(
  id: string,
  shape: AvatarPart['shape'],
  position: Vector3Tuple,
  scale: Vector3Tuple,
  color: string,
  rotation?: Vector3Tuple,
): AvatarPart {
  return { id, shape, position, scale, color, rotation }
}

export function hairParts(hair: PlayerProfile['hair'], hairColor: string): AvatarPart[] {
  if (hair === 'none') return []
  if (hair === 'curls')
    return Array.from({ length: 7 }, (_, index) => {
      const angle = (index / 7) * Math.PI * 2
      return avatarPart(
        `curl-${index}`,
        'sphere',
        [Math.cos(angle) * 0.3, 0.3, Math.sin(angle) * 0.23],
        [0.19, 0.17, 0.18],
        hairColor,
      )
    })
  const crown = avatarPart('hair-crown', 'sphere', [0, 0.28, -0.055], [0.445, 0.2, 0.37], hairColor)
  if (hair === 'bob')
    return [
      crown,
      avatarPart('hair-left', 'sphere', [-0.36, 0.02, -0.08], [0.12, 0.36, 0.31], hairColor),
      avatarPart('hair-right', 'sphere', [0.36, 0.02, -0.08], [0.12, 0.36, 0.31], hairColor),
    ]
  return [crown, avatarPart('fringe', 'box', [-0.12, 0.24, 0.29], [0.4, 0.12, 0.12], hairColor, [0, 0, -0.15])]
}

export function hatParts(hat: PlayerProfile['hat'], color: string): AvatarPart[] {
  if (hat === 'none') return []
  if (hat === 'beanie')
    return [
      avatarPart('beanie', 'sphere', [0, 0.37, 0], [0.46, 0.27, 0.4], color),
      avatarPart('pom', 'sphere', [0, 0.65, 0], [0.1, 0.1, 0.1], '#f0d6b5'),
    ]
  if (hat === 'sunhat')
    return [
      avatarPart('hat-crown', 'cylinder', [0, 0.45, 0], [0.38, 0.28, 0.34], color),
      avatarPart('hat-brim', 'cylinder', [0, 0.32, 0], [0.63, 0.045, 0.55], color),
    ]
  return [
    avatarPart('cap', 'sphere', [0, 0.34, 0], [0.46, 0.2, 0.4], color),
    avatarPart('cap-brim', 'box', [0, 0.28, 0.38], [0.62, 0.045, 0.4], color),
  ]
}

export function getAvatarAppearance(profile: PlayerProfile) {
  const { skin, hair: hairColor } = profile.colors
  const noseSize: Record<PlayerProfile['nose'], Vector3Tuple> = {
    button: [0.065, 0.055, 0.07],
    small: [0.035, 0.04, 0.035],
    wide: [0.095, 0.055, 0.05],
  }
  const eyeSize: Record<PlayerProfile['eyes'], Vector3Tuple> = {
    round: [0.048, 0.058, 0.032],
    oval: [0.035, 0.083, 0.032],
    happy: [0.058, 0.045, 0.035],
  }
  const earSize: Record<PlayerProfile['ears'], Vector3Tuple> = {
    round: [0.09, 0.12, 0.075],
    small: [0.06, 0.08, 0.055],
    pointed: [0.08, 0.23, 0.07],
  }
  const mouths: Record<PlayerProfile['mouth'], AvatarPart[]> = {
    smile: [avatarPart('smile', 'arc', [0, -0.18, 0.36], [0.1, 0.065, 0.025], ink, [0, 0, Math.PI])],
    grin: [
      avatarPart('grin', 'sphere', [0, -0.18, 0.365], [0.12, 0.067, 0.03], ink),
      avatarPart('teeth', 'box', [0, -0.158, 0.393], [0.16, 0.03, 0.012], '#fff6df'),
    ],
    quiet: [avatarPart('quiet', 'box', [0, -0.18, 0.37], [0.12, 0.019, 0.02], ink)],
  }
  const mustaches: Record<PlayerProfile['mustache'], AvatarPart[]> = {
    none: [],
    pencil: [avatarPart('mustache', 'box', [0, -0.115, 0.4], [0.22, 0.028, 0.035], hairColor)],
    curled: [-1, 1].map((side) =>
      avatarPart(`mustache-${side}`, 'sphere', [side * 0.09, -0.115, 0.4], [0.11, 0.04, 0.045], hairColor, [
        0,
        0,
        side * 0.3,
      ]),
    ),
  }
  const headParts: AvatarPart[] = [
    avatarPart('head', 'sphere', [0, 0, 0], [0.43, 0.42, 0.39], skin),
    avatarPart('nose', 'sphere', [0, -0.03, 0.4], noseSize[profile.nose], skin),
    ...[-1, 1].map((side) =>
      avatarPart(
        `eye-${side}`,
        profile.eyes === 'happy' ? 'arc' : 'sphere',
        [side * 0.15, 0.07, 0.355],
        eyeSize[profile.eyes],
        ink,
      ),
    ),
    ...[-1, 1].map((side) =>
      avatarPart(
        `ear-${side}`,
        profile.ears === 'pointed' ? 'cone' : 'sphere',
        [side * 0.43, 0, 0],
        earSize[profile.ears],
        skin,
        [0, 0, side * -0.9],
      ),
    ),
    ...mouths[profile.mouth],
    ...mustaches[profile.mustache],
    ...hairParts(profile.hair, hairColor),
    ...hatParts(profile.hat, profile.colors.hat),
  ]
  return {
    skin,
    top: profile.colors.top,
    bottom: profile.colors.bottom,
    shoes: profile.colors.shoes,
    shorts: profile.bottom === 'shorts',
    relaxed: profile.bottom === 'relaxed trousers',
    boots: profile.shoes === 'boots',
    longSleeves: profile.top !== 'tee',
    collar: profile.top === 'shirt',
    headParts,
  }
}
