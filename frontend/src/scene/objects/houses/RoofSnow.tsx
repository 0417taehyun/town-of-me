import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import type { Group } from 'three'
import { getSnowCover, seasonClock, type SeasonChange } from '../../environment/seasonTransition'

/** Roof snow that thickens as it falls and settles into the roof as it melts; `height` is where it rests. */
export function RoofSnow({
  seasonChange,
  height,
  children,
}: {
  seasonChange: MutableRefObject<SeasonChange>
  height: number
  children: ReactNode
}) {
  const layer = useRef<Group>(null)
  useFrame(() => {
    const cover = getSnowCover(seasonChange.current, seasonClock())
    if (!layer.current) return
    layer.current.visible = cover > 0.01
    layer.current.scale.set(0.72 + 0.28 * cover, cover, 0.72 + 0.28 * cover)
  })
  return (
    <group ref={layer} position={[0, height, 0]}>
      <group position={[0, -height, 0]}>{children}</group>
    </group>
  )
}
