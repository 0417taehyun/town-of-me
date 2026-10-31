import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, Object3D, Vector3, type DirectionalLight, type HemisphereLight } from 'three'
import type { MutableRefObject } from 'react'
import { getShadowLightPlacement, SUN_SHADOW_FRAME } from './dayCycle'
import { createDayLighting, writeDayLighting, type DayChange } from './dayTransition'
import type { Season } from './season'
import { seasonClock, type SeasonChange } from './seasonTransition'
import { useSeasonalColor } from './useSeasonChange'

/** Light bounced up from the ground: grass in the green seasons, fallen leaves in autumn, and snow in winter. */
const seasonBounceColors = {
  spring: '#6f8a5a',
  summer: '#5f7f4b',
  autumn: '#8a7146',
  winter: '#a9b6bc',
} satisfies Record<Season, string>

/** The shadow frame sits this far ahead of the player, so it covers what the follow camera looks at. */
const SHADOW_LOOK_AHEAD = 8
const EDITOR_SHADOW_FRAME = { ...SUN_SHADOW_FRAME, halfSize: 54, distance: 90 }

/** Sky fill from above and ground bounce from below; it fills every shadow, so shadows take its tint, not grey. */
export function SkyLight({
  dayChange,
  seasonChange,
}: {
  dayChange: MutableRefObject<DayChange>
  seasonChange: MutableRefObject<SeasonChange>
}) {
  const hemisphere = useRef<HemisphereLight>(null)
  const bounce = useRef({ color: new Color() })
  const lighting = useMemo(() => createDayLighting(), [])
  useSeasonalColor(bounce, seasonChange, seasonBounceColors, 'ground')
  useFrame(() => {
    const light = hemisphere.current
    if (!light) return
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    light.color.copy(lighting.skyLight)
    light.groundColor.copy(bounce.current.color)
    light.intensity = lighting.skyLightIntensity
  })
  return <hemisphereLight ref={hemisphere} />
}

/** The sun (or moon), whose shadow camera follows the player instead of stretching over the whole town. */
export function SunLight({
  dayChange,
  playerPosition,
  editing,
}: {
  dayChange: MutableRefObject<DayChange>
  playerPosition: MutableRefObject<Vector3>
  /** The editor shows the whole town at once, so its shadows cover all of it at a coarser resolution. */
  editing: boolean
}) {
  const light = useRef<DirectionalLight>(null)
  const target = useMemo(() => new Object3D(), [])
  const lighting = useMemo(() => createDayLighting(), [])
  const placement = useMemo(() => ({ position: new Vector3(), target: target.position }), [target])
  const focus = useMemo(() => new Vector3(), [])
  const frame = editing ? EDITOR_SHADOW_FRAME : SUN_SHADOW_FRAME
  useFrame(({ camera }) => {
    const sun = light.current
    if (!sun) return
    writeDayLighting(dayChange.current, seasonClock(), lighting)
    camera.getWorldDirection(focus).setY(0).normalize()
    focus.multiplyScalar(SHADOW_LOOK_AHEAD).add(playerPosition.current)
    if (editing) focus.set(0, 0, 0)
    getShadowLightPlacement(focus, lighting.sunDirection, placement, frame)
    sun.position.copy(placement.position)
    sun.color.copy(lighting.sunColor)
    sun.intensity = lighting.sunlight
    sun.shadow.intensity = lighting.shadow
  })
  const { halfSize, mapSize, distance } = frame
  return (
    <>
      <primitive object={target} />
      <directionalLight
        key={editing ? 'town' : 'player'}
        ref={light}
        target={target}
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-camera-left={-halfSize}
        shadow-camera-right={halfSize}
        shadow-camera-top={halfSize}
        shadow-camera-bottom={-halfSize}
        shadow-camera-near={1}
        shadow-camera-far={distance * 2}
        shadow-radius={2}
        shadow-bias={-0.0001}
        shadow-normalBias={0.02}
      />
    </>
  )
}
