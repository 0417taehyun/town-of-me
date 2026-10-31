import type { Gait, GaitStyle } from './gait'
import { createPlantedFeetGait } from './plantedFeetGait'
import { createKeyPosesGait } from './walkCycle'

const gaits: Record<GaitStyle, () => Gait> = {
  plantedFeet: createPlantedFeetGait,
  keyPoses: createKeyPosesGait,
}

export function createGait(style: GaitStyle): Gait {
  return gaits[style]()
}
