export type NaturePropKind = 'rock' | 'bush' | 'mushroom' | 'pumpkin'

const naturePropSpecs = {
  rock: {
    file: 'rock_smallE.glb',
    baseScale: 7.4,
    radius: 1.28,
    height: 1.9,
    solid: true,
    reactive: false,
  },
  bush: {
    file: 'plant_bushDetailed.glb',
    baseScale: 4.2,
    radius: 1.05,
    height: 1.5,
    solid: false,
    reactive: true,
  },
  mushroom: {
    file: 'mushroom_redGroup.glb',
    baseScale: 5.3,
    radius: 0.68,
    height: 1.32,
    solid: true,
    reactive: false,
  },
  pumpkin: {
    file: 'crop_pumpkin.glb',
    baseScale: 3.8,
    radius: 0.82,
    height: 1.28,
    solid: true,
    reactive: false,
  },
} satisfies Record<
  NaturePropKind,
  {
    file: string
    baseScale: number
    radius: number
    height: number
    solid: boolean
    reactive: boolean
  }
>

export const naturePropFiles = Object.values(naturePropSpecs).map(({ file }) => file)

export function getNaturePropLayout(kind: NaturePropKind, size = 1) {
  const spec = naturePropSpecs[kind]
  const scale = spec.baseScale * size
  return {
    ...spec,
    scale,
    radius: spec.radius * size,
    height: spec.height * size,
    groundOffset: 0.05 * scale,
  }
}
