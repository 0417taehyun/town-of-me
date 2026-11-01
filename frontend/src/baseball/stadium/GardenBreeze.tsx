import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  CircleGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
} from 'three'
import { damp } from '../../motionMath'
import { createDayLighting, writeDayLighting, type DayChange } from '../../scene/environment/dayTransition'
import type { Season } from '../../scene/environment/season'
import { seasonClock, type SeasonChange } from '../../scene/environment/seasonTransition'
import { writeInstanceColors, writeInstanceMatrices } from '../../scene/instancedMeshes'
import type { BallView } from '../stage/ballMeshes'
import { flowerBeds } from './bowlLayout'
import {
  advancePetal,
  BREEZE_COUNTS,
  BURST,
  burstForHomeRun,
  BUTTERFLY_COLORS,
  createPetalPool,
  createWingGeometry,
  DRIFT_SHARE,
  homeRunBurstDue,
  petalColor,
  poseBurstPetal,
  poseButterflyWing,
  poseDriftPetal,
  type Sight,
} from './breezeLayout'

/**
 * The garden's breeze (breezeLayout.ts): the season's petals or leaves drifting round the park, butterflies over the
 * flower beds by day, and a burst of petals over the hedge and from the far light towers when a `homeRun`'s ball
 * clears the hedge. Everything keeps clear of the pitch and of the camera's line to `ballViewRef`'s ball; a `reduced`
 * tier draws fewer. Three instanced meshes; the page leaves the breeze out under reduced motion.
 */
export function GardenBreeze({
  seasonChange,
  dayChange,
  ballViewRef,
  homeRun,
  reduced,
}: {
  seasonChange: MutableRefObject<SeasonChange>
  dayChange: MutableRefObject<DayChange>
  ballViewRef: MutableRefObject<BallView | null>
  homeRun: boolean
  reduced: boolean
}) {
  const counts = reduced ? BREEZE_COUNTS.reduced : BREEZE_COUNTS.full
  const parts = useMemo(
    () => ({
      petal: new CircleGeometry(1, 8),
      wing: createWingGeometry(),
      // Petals as the town's falling ones are drawn (Atmosphere.tsx); butterflies are lit like the garden's flowers.
      petals: new MeshBasicMaterial({
        side: DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
      wings: new MeshLambertMaterial({ side: DoubleSide }),
    }),
    [],
  )
  useEffect(() => () => Object.values(parts).forEach((part) => part.dispose()), [parts])
  const pool = useMemo(() => createPetalPool(BURST.capacity), [])
  const beds = useMemo(() => flowerBeds(), [])
  const lighting = useMemo(() => createDayLighting(), [])
  const dummies = useMemo(() => {
    const wing = new Object3D()
    wing.rotation.order = 'YXZ'
    return { petal: new Object3D(), wing }
  }, [])
  const drift = useRef<InstancedMesh>(null)
  const burst = useRef<InstancedMesh>(null)
  const wings = useRef<InstancedMesh>(null)
  const breeze = useRef({ elapsed: 0, season: null as Season | null, burst: false, butterflies: 0 })
  const homeRunNow = useRef(homeRun)
  useLayoutEffect(() => {
    homeRunNow.current = homeRun
  }, [homeRun])
  useLayoutEffect(() => {
    ;[drift.current, burst.current, wings.current].forEach((mesh) => mesh?.instanceMatrix.setUsage(DynamicDrawUsage))
    if (burst.current) burst.current.instanceColor = new InstancedBufferAttribute(pool.colors, 3)
    writeInstanceColors(
      wings.current,
      BREEZE_COUNTS.full.butterflies * 2,
      (index) => BUTTERFLY_COLORS[Math.floor(index / 2) % BUTTERFLY_COLORS.length],
    )
  }, [pool])

  useFrame(({ camera }, delta) => {
    const state = breeze.current
    const step = Math.min(delta, 0.1)
    state.elapsed += step
    const { elapsed } = state
    const season = seasonChange.current.to
    const view = ballViewRef.current
    const sight: Sight = { eye: camera.position, ball: view?.visible ? view.position : null }

    if (season !== state.season) writeInstanceColors(drift.current, counts.drift, (index) => petalColor(season, index))
    state.season = season
    const driftCount = Math.round(counts.drift * DRIFT_SHARE[season])
    if (drift.current) drift.current.count = driftCount
    writeInstanceMatrices(drift.current, dummies.petal, driftCount, (petal, index) =>
      poseDriftPetal(petal, index, elapsed, sight),
    )

    const due = homeRunBurstDue(homeRunNow.current, state.burst, view)
    state.burst = homeRunNow.current && (state.burst || due)
    if (due && view) burstForHomeRun(pool, view.position, season, elapsed, counts.burst)
    if (due && burst.current?.instanceColor) burst.current.instanceColor.needsUpdate = true
    const bursting = elapsed < pool.endsAt
    if (burst.current) burst.current.visible = bursting
    if (bursting) pool.lives.forEach((_, index) => advancePetal(pool, index, step))
    if (bursting)
      writeInstanceMatrices(burst.current, dummies.petal, BURST.capacity, (petal, index) =>
        poseBurstPetal(petal, pool, index, elapsed, sight),
      )

    writeDayLighting(dayChange.current, seasonClock(), lighting)
    const daylight = (1 - lighting.night) * Number(season !== 'winter')
    state.butterflies = damp(state.butterflies, daylight, 1.5, step)
    const flying = state.butterflies > 0.02
    if (wings.current) wings.current.visible = flying
    if (wings.current) wings.current.count = counts.butterflies * 2
    if (flying)
      writeInstanceMatrices(wings.current, dummies.wing, counts.butterflies * 2, (wing, index) =>
        poseButterflyWing(wing, index, elapsed, beds, state.butterflies),
      )
  })

  return (
    <group>
      <instancedMesh
        ref={drift}
        args={[parts.petal, parts.petals, BREEZE_COUNTS.full.drift]}
        count={0}
        renderOrder={2}
        frustumCulled={false}
      />
      <instancedMesh
        ref={burst}
        args={[parts.petal, parts.petals, BURST.capacity]}
        visible={false}
        renderOrder={2}
        frustumCulled={false}
      />
      <instancedMesh
        ref={wings}
        args={[parts.wing, parts.wings, BREEZE_COUNTS.full.butterflies * 2]}
        visible={false}
        frustumCulled={false}
      />
    </group>
  )
}
