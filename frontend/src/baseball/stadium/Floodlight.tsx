import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import { type DirectionalLight, Object3D } from 'three'
import { createDayLighting, writeDayLighting, type DayChange } from '../../scene/environment/dayTransition'
import { seasonClock } from '../../scene/environment/seasonTransition'

/** Where the light comes from and falls on (behind home plate, onto the infield), and how bright it is at full night. */
const FLOODLIGHT = {
  from: [0, 70, 45] as [number, number, number],
  onto: [0, 0, -30] as [number, number, number],
  color: '#fff1d8',
  intensity: 1.6,
}

/**
 * The light towers' floodlight: one warm light over the field from behind home plate that grows as night falls, so the
 * ball and the chalk read at night as by day (the strike zone's box is drawn unlit). It casts no shadow, and it stays
 * in the scene at nothing by day, so the night coming never recompiles a material.
 */
export function Floodlight({ dayChange }: { dayChange: MutableRefObject<DayChange> }) {
  const light = useRef<DirectionalLight>(null)
  const target = useMemo(() => {
    const onto = new Object3D()
    onto.position.set(...FLOODLIGHT.onto)
    return onto
  }, [])
  const lighting = useMemo(() => createDayLighting(), [])
  useFrame(() => {
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    if (light.current) light.current.intensity = FLOODLIGHT.intensity * lighting.night
  })
  return (
    <>
      <primitive object={target} />
      <directionalLight ref={light} position={FLOODLIGHT.from} target={target} color={FLOODLIGHT.color} intensity={0} />
    </>
  )
}
