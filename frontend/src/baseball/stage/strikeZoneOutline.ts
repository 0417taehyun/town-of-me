import { BoxGeometry, BufferGeometry, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { damp } from '../../motionMath'
import type { DerbyPhase } from '../game/derby'
import { BALL_RADIUS, BATTER_REACH, CONTACT_DEPTH, STRIKE_ZONE } from '../game/field'
import { DRAWN_RIM_RADIUS } from './ballMeshes'

// The strike zone as a faint box while a pitch comes, so the strikes the pitcher throws read as strikes. The batting
// shot looks down from above the catcher, so a ball farther off is drawn higher: one flat frame shows a strike nearer
// the pitcher than itself above it. The box runs instead from where the bat meets the ball (its front face), over the
// plate, to where a pitch let go by waits (its back face). Every pitch stays inside the zone over that stretch
// (game/pitchSchedule.test.ts), so it is drawn inside the box as the visitor swings, over the plate, and as it waits.

/** How far (m) a bar reaches outside the opening, how opaque the box gets, and how fast (per second) it fades in. */
export const STRIKE_ZONE_OUTLINE = { barWidth: 0.018, opacity: 0.75, fadeInRate: 6 }

const rimGrowth = DRAWN_RIM_RADIUS - BALL_RADIUS

/**
 * The box's opening (m) and its faces' field z. The ball is drawn larger than life inside a dark rim, so the opening is
 * the zone grown by how much wider that rim is than a real ball: the drawn ball, rim and all, sits in the opening
 * exactly when the real ball is inside the zone.
 */
export const STRIKE_ZONE_BOX = {
  halfWidth: STRIKE_ZONE.halfWidth + rimGrowth,
  bottom: STRIKE_ZONE.bottom - rimGrowth,
  top: STRIKE_ZONE.top + rimGrowth,
  front: -CONTACT_DEPTH,
  back: -BATTER_REACH.back,
}

export type StrikeZoneOutline = Mesh<BufferGeometry, MeshBasicMaterial>

/** The box's front and back frames and the four bars joining their outer corners, in one faint mesh. */
export function createStrikeZoneOutline(): StrikeZoneOutline {
  const { halfWidth, bottom, top, front, back } = STRIKE_ZONE_BOX
  const { barWidth } = STRIKE_ZONE_OUTLINE
  const frame = traceRectangle(new Shape(), halfWidth + barWidth, bottom - barWidth, top + barWidth)
  frame.holes.push(traceRectangle(new Path(), halfWidth, bottom, top))
  const faces = [front, back].map((z) => new ShapeGeometry(frame).translate(0, 0, z))
  const corner = { x: halfWidth + barWidth / 2, bottom: bottom - barWidth / 2, top: top + barWidth / 2 }
  const edges = [-corner.x, corner.x].flatMap((x) =>
    [corner.bottom, corner.top].map((y) =>
      new BoxGeometry(barWidth, barWidth, back - front).translate(x, y, (front + back) / 2),
    ),
  )
  const parts = [...faces, ...edges]
  const box = mergeGeometries(parts) ?? new BufferGeometry()
  parts.forEach((part) => part.dispose())
  const outline = new Mesh(
    box,
    new MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0, depthWrite: false }),
  )
  outline.visible = false
  return outline
}

/** Traces onto `path` a rectangle reaching `halfWidth` either side of the plate's middle, from `bottom` to `top`. */
export function traceRectangle<Traced extends Path>(path: Traced, halfWidth: number, bottom: number, top: number) {
  path.moveTo(-halfWidth, bottom).lineTo(halfWidth, bottom).lineTo(halfWidth, top).lineTo(-halfWidth, top).closePath()
  return path
}

/**
 * Fades the box in through the windup and keeps it while the pitch comes. Once the pitch is judged it goes at once,
 * leaving the batted ball or the catch to watch.
 */
export function drawStrikeZoneOutline(
  outline: StrikeZoneOutline,
  phase: DerbyPhase | null,
  delta: number,
  reducedMotion: boolean,
) {
  const { material } = outline
  outline.visible = phase === 'windup' || phase === 'pitch'
  if (!outline.visible) {
    material.opacity = 0
    return
  }
  const { opacity, fadeInRate } = STRIKE_ZONE_OUTLINE
  material.opacity = reducedMotion ? opacity : damp(material.opacity, opacity, fadeInRate, delta)
}

export function disposeStrikeZoneOutline(outline: StrikeZoneOutline) {
  outline.geometry.dispose()
  outline.material.dispose()
}
