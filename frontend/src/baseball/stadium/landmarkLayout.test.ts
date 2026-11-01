import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { FOUL_ANGLE } from '../game/field'
import { sprayPoint } from '../game/flight'
import { SPRAY_RULES } from '../game/landing'
import { chaseShot } from '../stage/cameraShots'
import { createShedGeometries } from './landmarkLayout'

const sheds = Object.values(createShedGeometries()).map(
  (geometry) => new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })),
)

/** Whether the chase camera following `ball` sees it past both dugouts. */
function seenPastDugouts(ball: Vector3) {
  const { x, y, z } = chaseShot(ball).position
  const eye = new Vector3(x, y, z)
  const raycaster = new Raycaster(eye, ball.clone().sub(eye).normalize(), 0, eye.distanceTo(ball))
  return raycaster.intersectObjects(sheds, false).length === 0
}

describe('the dugouts', () => {
  it('keep a foul coming down beyond them in the chase camera’s sight until it is within 3 m of the grass', () => {
    const sprays = [-1, 1].flatMap((side) =>
      Array.from(
        { length: 11 },
        (_, step) => side * (FOUL_ANGLE + SPRAY_RULES.foulMinimum + (step / 10) * SPRAY_RULES.foulSpan),
      ),
    )
    const fouls = sprays.flatMap((spray) =>
      Array.from({ length: 15 }, (_, step) => {
        const { x, z } = sprayPoint(spray, 35 + step * 5)
        return new Vector3(x, 3, z)
      }),
    )
    expect(fouls.filter((ball) => !seenPastDugouts(ball))).toEqual([])
  })
})
