import {
  BackSide,
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
} from 'three'
import type { Vec3 } from '../../data/models'
import { clamp, damp } from '../../motionMath'
import { BALL_RADIUS } from '../game/field'
import { FIELD_LAYERS } from '../stadium/fieldLayout'

// The ball as drawn: a regulation ball 1.8 times larger with red seams, a dark rim so it reads against sky and grass,
// a soft glow around it on its way (warm once it is hit), a trail behind it, a blob on the ground under it, and a ring
// where a ball in play will come down.

/** A regulation ball 18 m away is a few pixels wide; drawn this much larger it still reads. */
export const BALL_DISPLAY_SCALE = 1.8
export const DRAWN_BALL_RADIUS = BALL_RADIUS * BALL_DISPLAY_SCALE
/** The dark rim around the drawn ball, the edge the visitor sees against the dirt. */
export const DRAWN_RIM_RADIUS = DRAWN_BALL_RADIUS * 1.3
export const TRAIL_LENGTH = 8
/** The fewest pixels across the ball may shrink to: a pitch stays near, a batted ball is chased far out. */
export const MINIMUM_BALL_PIXELS = { pitched: 6, flying: 12 }
/** The landing ring's outer diameter (m), and the fewest pixels across it may shrink to far out in the field. */
export const LANDING_RING = { size: 2.2, pixels: 32 }

/**
 * The glow around a moving ball: its size (m), pale on a pitch and warm off the bat, and the fewest pixels across it may
 * shrink to, so a ball far out in the field still reads.
 */
export const BALL_GLOW = {
  size: DRAWN_BALL_RADIUS * 4,
  pitched: { color: '#fff2d2', opacity: 0.8, pixels: 22 },
  flying: { color: '#ffbe5c', opacity: 1, pixels: 40 },
}

/** A spin about `axis` (normalized when drawn). */
export type BallSpin = { axis: Vec3; radiansPerSecond: number }

/** The ball on one frame: where it is, how it spins, its trail (newest first), and where it will land, if shown. */
export type BallView = {
  visible: boolean
  position: Vec3
  spin: BallSpin | null
  flying: boolean
  trail: Vec3[]
  landing: { x: number; z: number } | null
}

export type BallParts = {
  group: Group
  ball: Mesh<SphereGeometry, MeshStandardMaterial>
  rim: Mesh<SphereGeometry, MeshBasicMaterial>
  glow: Sprite
  shadow: Mesh<CircleGeometry, MeshBasicMaterial>
  trail: Mesh<SphereGeometry, MeshBasicMaterial>[]
  ring: Mesh<RingGeometry, MeshBasicMaterial>
}

/** Two red seams winding round an off-white ball, drawn across a texture that wraps the sphere once. */
export function drawSeams(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = '#fbf8f1'
  context.fillRect(0, 0, width, height)
  context.strokeStyle = '#c8473c'
  context.lineWidth = 6
  ;[0, width / 2].forEach((offset) => drawSeam(context, offset, width / 2, height))
}

export function drawSeam(context: CanvasRenderingContext2D, offset: number, length: number, height: number) {
  context.beginPath()
  for (let x = 0; x <= length; x += 4) {
    context.lineTo(offset + x, height / 2 + Math.sin((x / length) * Math.PI * 2) * height * 0.28)
  }
  context.stroke()
}

export function createSeamTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) drawSeams(context, canvas.width, canvas.height)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** A round light, bright in the middle and gone at the edge, for the ball's glow and the stage's flashes. */
export function drawGlowGradient(context: CanvasRenderingContext2D, size: number) {
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.3, 'rgba(255, 246, 222, 0.6)')
  gradient.addColorStop(1, 'rgba(255, 240, 210, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
}

export function createGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) drawGlowGradient(context, canvas.width)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export function createBallParts(): BallParts {
  const ball = new Mesh(
    new SphereGeometry(DRAWN_BALL_RADIUS, 24, 16),
    new MeshStandardMaterial({
      map: createSeamTexture(),
      roughness: 0.45,
      emissive: '#fff6e4',
      emissiveIntensity: 0.35,
    }),
  )
  ball.castShadow = true
  const rim = new Mesh(
    new SphereGeometry(DRAWN_RIM_RADIUS, 20, 14),
    new MeshBasicMaterial({ color: '#2a2420', side: BackSide, transparent: true, opacity: 0.6 }),
  )
  ball.add(rim)
  // The glow never writes depth, and the rim draws after it, so the rim stays crisp over the halo.
  const glow = new Sprite(
    new SpriteMaterial({ map: createGlowTexture(), transparent: true, depthWrite: false, fog: false }),
  )
  glow.renderOrder = 1
  rim.renderOrder = 2
  const shadow = new Mesh(
    new CircleGeometry(DRAWN_BALL_RADIUS * 1.6, 20),
    new MeshBasicMaterial({ color: '#1d1a17', transparent: true, opacity: 0.3, depthWrite: false }),
  )
  shadow.rotation.x = -Math.PI / 2
  const trail = Array.from(
    { length: TRAIL_LENGTH },
    (_, index) =>
      new Mesh(
        new SphereGeometry(DRAWN_BALL_RADIUS * (0.9 - index * 0.07), 12, 8),
        new MeshBasicMaterial({
          color: '#fffaf0',
          transparent: true,
          opacity: 0.42 * (1 - index / TRAIL_LENGTH),
          depthWrite: false,
        }),
      ),
  )
  const ring = new Mesh(
    new RingGeometry((LANDING_RING.size / 2) * 0.73, LANDING_RING.size / 2, 40),
    new MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
  )
  ring.rotation.x = -Math.PI / 2
  const group = new Group()
  group.add(ball, glow, shadow, ring, ...trail)
  return { group, ball, rim, glow, shadow, trail, ring }
}

export function disposeBallParts(parts: BallParts) {
  const meshes = [parts.ball, parts.rim, parts.shadow, parts.ring, ...parts.trail]
  parts.ball.material.map?.dispose()
  parts.glow.material.map?.dispose()
  parts.glow.material.dispose()
  meshes.forEach((mesh) => {
    mesh.geometry.dispose()
    mesh.material.dispose()
  })
}

/** How much larger than drawn something `size` m across must be to stay `pixels` across `distance` m away. */
export function minimumScreenScale(
  distance: number,
  fovDegrees: number,
  viewportHeight: number,
  pixels: number,
  size = 2 * DRAWN_BALL_RADIUS,
) {
  const focal = viewportHeight / 2 / Math.tan((fovDegrees * Math.PI) / 360)
  const across = (size * focal) / Math.max(distance, 0.1)
  return Math.max(1, pixels / across)
}

const spinAxis = new Vector3()
const ballAt = new Vector3()

export function drawBall(
  parts: BallParts,
  view: BallView,
  camera: PerspectiveCamera,
  viewportHeight: number,
  delta: number,
) {
  parts.group.visible = view.visible
  if (!view.visible) return
  const { ball, rim, shadow, ring } = parts
  const { x, y, z } = view.position
  if (view.spin)
    ball.rotateOnWorldAxis(
      spinAxis.set(view.spin.axis.x, view.spin.axis.y, view.spin.axis.z).normalize(),
      view.spin.radiansPerSecond * delta,
    )
  const pixels = view.flying ? MINIMUM_BALL_PIXELS.flying : MINIMUM_BALL_PIXELS.pitched
  const scale = minimumScreenScale(camera.position.distanceTo(ballAt.set(x, y, z)), camera.fov, viewportHeight, pixels)
  ball.scale.setScalar(scale)
  // A ball drawn larger than life rests on the grass instead of sinking into it.
  ball.position.set(x, Math.max(y, DRAWN_BALL_RADIUS * scale), z)
  rim.material.opacity = view.flying ? 0.85 : 0.6
  drawGlow(parts.glow, ball.position, view, camera, viewportHeight)
  // Above the dirt, chalk, and plate, so the shadow shows where the ball's height matters most.
  shadow.position.set(x, FIELD_LAYERS.chalk + 0.01, z)
  shadow.scale.setScalar(scale)
  shadow.material.opacity = clamp(0.32 - y * 0.03, 0.08, 0.32)
  parts.trail.forEach((ghost, index) => placeGhost(ghost, view.trail[index], scale))
  ring.material.opacity = damp(ring.material.opacity, view.landing ? 0.75 : 0, 6, delta)
  if (!view.landing) return
  ring.position.set(view.landing.x, 0.05, view.landing.z)
  const ringDistance = camera.position.distanceTo(ring.position)
  ring.scale.setScalar(
    minimumScreenScale(ringDistance, camera.fov, viewportHeight, LANDING_RING.pixels, LANDING_RING.size),
  )
}

/**
 * The glow on the ball drawn `at`, while it is on its way, pitched or hit; none while it rests in a hand, the mitt, or
 * the grass.
 */
export function drawGlow(glow: Sprite, at: Vector3, view: BallView, camera: PerspectiveCamera, viewportHeight: number) {
  glow.visible = view.spin !== null
  const look = view.flying ? BALL_GLOW.flying : BALL_GLOW.pitched
  glow.position.copy(at)
  glow.material.color.set(look.color)
  glow.material.opacity = look.opacity
  const distance = camera.position.distanceTo(glow.position)
  glow.scale.setScalar(
    BALL_GLOW.size * minimumScreenScale(distance, camera.fov, viewportHeight, look.pixels, BALL_GLOW.size),
  )
}

export function placeGhost(ghost: Mesh, point: Vec3 | undefined, scale: number) {
  ghost.visible = point !== undefined
  if (!point) return
  ghost.position.set(point.x, point.y, point.z)
  ghost.scale.setScalar(scale)
}
