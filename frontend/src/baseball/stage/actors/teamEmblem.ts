import { CircleGeometry, Shape, ShapeGeometry, Vector2 } from 'three'
import { addPart, BALLPLAYER_BODY, type BallplayerRig } from './ballplayerRig'
import type { TeamEmblem } from './teamUniforms'

// A team's emblem on a jersey's chest: a round badge with a mark on it, two flat shapes just off the torso's front, big
// enough to read from the batting camera on the pitcher and from the chase camera on the fielders. It has no solid, so
// nothing keeps out of it, and every rig shares its few triangles, which a crew's batch draws as instances of each shape.

const BADGE_RADIUS = 0.12
/** On the left chest, as on a real jersey, where the pitcher's glove and hand at his set leave it in view. */
const BADGE_X = 0.14
const BADGE_HEIGHT = BALLPLAYER_BODY.torso.centerY + 0.13
const TORSO_FRONT = BALLPLAYER_BODY.torso.depth / 2
/** How far each layer stands off the one behind it, enough not to flicker from across the field. */
const LAYER_GAP = 0.006

/** A flat mark of `points` corners around its middle, the first straight up, each `radiusAt(index)` from the middle. */
export function radialMarkGeometry(points: number, radiusAt: (index: number) => number) {
  const corners = Array.from({ length: points }, (_, index) => {
    const angle = Math.PI / 2 + (index / points) * Math.PI * 2
    return new Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(radiusAt(index))
  })
  return new ShapeGeometry(new Shape(corners))
}

const badgeGeometry = new CircleGeometry(BADGE_RADIUS, 20)
const markGeometries = {
  star: radialMarkGeometry(10, (index) => (index % 2 === 0 ? 0.1 : 0.044)),
  // Five round petals: the radius swells and falls five times around.
  flower: radialMarkGeometry(40, (index) => 0.06 + 0.04 * Math.abs(Math.cos((index / 40) * 5 * Math.PI))),
} satisfies Record<TeamEmblem['mark'], ShapeGeometry>

/** Puts `emblem` on the chest of `rig`, turning with it; a player with none, such as the umpire, stays plain. */
export function addTeamEmblem(rig: Pick<BallplayerRig, 'materials' | 'body'>, emblem: TeamEmblem | undefined) {
  if (!emblem) return
  const layers = [
    addPart(rig, rig.body, badgeGeometry, emblem.badgeColor),
    addPart(rig, rig.body, markGeometries[emblem.mark], emblem.markColor),
  ]
  layers.forEach((layer, index) => {
    layer.position.set(BADGE_X, BADGE_HEIGHT, TORSO_FRONT + LAYER_GAP * (index + 1))
    layer.castShadow = false
  })
}
