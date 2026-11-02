import {
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  type Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  CircleGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { DEFAULT_PLAYER_PROFILE, type PlayerProfile } from '../../data/playerProfile'
import { ink } from '../characters/avatarAppearance'
import {
  DEFAULT_BATTER_COLOR,
  EYE_FINISH,
  FIGURE_FINISH,
  FIGURE_HEIGHT,
  PEDESTAL,
  PEDESTAL_COLORS,
  PLASTER,
  RANK_FINISHES,
  type RankFinish,
  SPARKLE_SPOTS,
  type StatueRank,
  TOWN_CHARACTER_HEIGHT,
} from './statueFinishes'
import { createStatueFigure, type FigurePaint, figureGeometries, HAND_REACH, type StatueFigure } from './statueFigure'
import type { StatueTextures } from './statueTextures'

// A painted statue (leaderboard spec §6.5): the visitor's character in its own colors, glossy like a vinyl figure, on a
// round trophy pedestal whose metal says the place. First lifts a cup and cheers, second rests a bat on the shoulder and
// waves, third cheers with both arms. An empty pedestal holds a plaster figure and no props. The plaque carries only
// its place's star: names and links are page text, which reads clearly, links for real, and reaches a screen reader.
// Origin at the pedestal's floor centre, facing +z.

export type PaintedStatue = {
  group: Group
  /** Poses it at `seconds`; `motion` from 0 (its rest pose) to 1 scales the sway, the wave, and the twinkles. */
  update: (seconds: number, motion: number) => void
  dispose: () => void
}

const up = new Vector3(0, 1, 0)
const down = new Vector3(0, -1, 0)

export function latheMesh(points: [number, number][], material: Material, segments = 64) {
  const mesh = new Mesh(
    new LatheGeometry(
      points.map(([radius, y]) => new Vector2(radius, y)),
      segments,
    ),
    material,
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** A ring lying flat at height `y`. */
export function flatRing(radius: number, tube: number, y: number, material: Material) {
  const ring = new Mesh(new TorusGeometry(radius, tube, 12, 96), material)
  ring.rotation.x = Math.PI / 2
  ring.position.y = y
  return ring
}

/** A plane wrapped round a cylinder of `radius`, facing +z, so the plaque hugs the round pedestal without a gap. */
export function bentPlane(width: number, height: number, radius: number) {
  const geometry = new PlaneGeometry(width, height, 32, 1)
  const position = geometry.attributes.position
  for (let index = 0; index < position.count; index++) {
    const angle = position.getX(index) / radius
    position.setXYZ(index, Math.sin(angle) * radius, position.getY(index), Math.cos(angle) * radius)
  }
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A round cake pedestal on a wide plinth: a fat metal rim on its top edge over a broad metal band, a thin bead at its
 * foot, and a plaque with the place's star in front. Returns it with the height of its top.
 */
export function createPedestal(
  finish: RankFinish,
  metal: MeshStandardMaterial,
  textures: StatueTextures,
  rank: StatueRank,
) {
  const { radius, plinthRadius, plinthHeight, plaqueWidth, plaqueHeight, band } = PEDESTAL
  const top = plinthHeight + finish.bodyHeight
  const pedestal = new Group()
  const plinthMaterial = new MeshStandardMaterial({ color: PEDESTAL_COLORS.plinth, roughness: 0.9 })
  const bodyMaterial = new MeshStandardMaterial({ color: PEDESTAL_COLORS.pedestal, roughness: 0.85 })
  pedestal.add(
    latheMesh(
      [
        [0, 0],
        [plinthRadius - 0.02, 0],
        [plinthRadius, 0.02],
        [plinthRadius, plinthHeight - 0.03],
        [plinthRadius - 0.03, plinthHeight],
        [0, plinthHeight],
      ],
      plinthMaterial,
    ),
    latheMesh(
      [
        [0, plinthHeight],
        [radius - 0.015, plinthHeight],
        [radius, plinthHeight + 0.015],
        [radius, top - 0.05],
        [radius - 0.03, top - 0.01],
        [radius - 0.08, top],
        [0, top],
      ],
      bodyMaterial,
    ),
  )
  const rim = flatRing(radius - 0.025, 0.05, top - 0.025, metal)
  rim.castShadow = true
  const bandTop = top - 0.045
  const stripe = new Mesh(new CylinderGeometry(radius + 0.006, radius + 0.006, band, 96, 1, true), metal)
  stripe.position.y = bandTop - band / 2
  stripe.receiveShadow = true
  pedestal.add(
    rim,
    flatRing(radius + 0.002, 0.018, plinthHeight + 0.02, metal),
    stripe,
    flatRing(radius + 0.006, 0.012, bandTop - band, metal),
  )
  // Centred between the foot bead and the band, so it fits even third place's short pedestal.
  const plaqueY = (plinthHeight + 0.038 + bandTop - band - 0.012) / 2
  const frameMaterial = new MeshStandardMaterial({
    color: finish.metal,
    metalness: 1,
    roughness: finish.roughness,
    envMap: textures.environment,
    envMapIntensity: 1,
    alphaMap: textures.frameMask,
    alphaTest: 0.5,
  })
  const frame = new Mesh(bentPlane(plaqueWidth + 0.03, plaqueHeight + 0.03, radius + 0.004), frameMaterial)
  const plaqueMaterial = new MeshStandardMaterial({ map: textures.plaques[rank], roughness: 0.5, alphaTest: 0.5 })
  const plaque = new Mesh(bentPlane(plaqueWidth, plaqueHeight, radius + 0.008), plaqueMaterial)
  frame.position.y = plaqueY
  plaque.position.y = plaqueY
  pedestal.add(frame, plaque)
  return { pedestal, top }
}

/** The champion's cup with ear handles and a little baseball in its bowl; origin at its foot. */
export function createTrophy(metal: Material) {
  const trophy = new Group()
  const cupProfile: [number, number][] = [
    [0, 0],
    [0.1, 0],
    [0.105, 0.012],
    [0.085, 0.03],
    [0.035, 0.045],
    [0.028, 0.08],
    [0.048, 0.1],
    [0.03, 0.12],
    [0.05, 0.15],
    [0.11, 0.2],
    [0.145, 0.28],
    [0.155, 0.33],
    [0.142, 0.335],
    [0.12, 0.29],
    [0, 0.25],
  ]
  trophy.add(latheMesh(cupProfile, metal, 40))
  const handleGeometry = new TorusGeometry(0.065, 0.016, 8, 20, Math.PI)
  for (const side of [-1, 1]) {
    const handle = new Mesh(handleGeometry, metal)
    handle.position.set(side * 0.115, 0.255, 0)
    handle.rotation.z = (side * -Math.PI) / 2
    trophy.add(handle)
  }
  const ball = new Mesh(
    new SphereGeometry(0.075, 20, 14),
    new MeshStandardMaterial({ color: '#f7f1e3', roughness: 0.55 }),
  )
  ball.position.y = 0.31
  const stitchGeometry = new TorusGeometry(0.054, 0.007, 6, 24)
  const stitchMaterial = new MeshStandardMaterial({ color: '#ca7765', roughness: 0.7 })
  for (const side of [-1, 1]) {
    const stitch = new Mesh(stitchGeometry, stitchMaterial)
    stitch.position.x = side * 0.052
    stitch.rotation.y = Math.PI / 2
    ball.add(stitch)
  }
  trophy.add(ball)
  return trophy
}

/** A light wooden bat with navy grip tape; origin at the knob, barrel along +y (town units). */
export function createBat() {
  const bat = new Group()
  const woodProfile: [number, number][] = [
    [0, 0],
    [0.046, 0],
    [0.05, 0.02],
    [0.032, 0.04],
    [0.027, 0.09],
    [0.03, 0.32],
    [0.046, 0.5],
    [0.06, 0.66],
    [0.064, 0.74],
    [0.052, 0.8],
    [0, 0.812],
  ]
  const tape = new Mesh(
    new CylinderGeometry(0.032, 0.031, 0.16, 16),
    new MeshStandardMaterial({ color: '#374b65', roughness: 0.75 }),
  )
  tape.position.y = 0.13
  bat.add(latheMesh(woodProfile, new MeshStandardMaterial({ color: '#d2a477', roughness: 0.5 }), 24), tape)
  return bat
}

/** The rosette pinned on the figure's left chest: satin petals, a cream ring, a shiny metal button, and two tails. */
export function createRosette(finish: RankFinish, metal: Material) {
  const rosette = new Group()
  const satin = new MeshStandardMaterial({ color: finish.ribbon, roughness: 0.55 })
  const petals = new Shape()
  petals.moveTo(0.097, 0)
  for (let step = 1; step <= 72; step++) {
    const angle = (step / 72) * Math.PI * 2
    const reach = 0.085 + 0.012 * Math.cos(angle * 12)
    petals.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach)
  }
  const bevel = { depth: 0.014, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }
  const ring = new Mesh(
    new CylinderGeometry(0.06, 0.06, 0.02, 32),
    new MeshStandardMaterial({ color: '#f6efdf', roughness: 0.7 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.z = 0.02
  const button = new Mesh(new SphereGeometry(0.046, 24, 12), metal)
  button.scale.z = 0.45
  button.position.z = 0.03
  const tail = new Shape()
  tail.moveTo(-0.028, 0)
  tail.lineTo(0.028, 0)
  tail.lineTo(0.03, -0.15)
  tail.lineTo(0, -0.125)
  tail.lineTo(-0.03, -0.15)
  tail.closePath()
  const tailGeometry = new ExtrudeGeometry(tail, { depth: 0.008, bevelEnabled: false })
  for (const side of [-1, 1]) {
    const tailMesh = new Mesh(tailGeometry, satin)
    tailMesh.position.set(side * 0.03, -0.03, -0.006)
    tailMesh.rotation.z = side * 0.28
    rosette.add(tailMesh)
  }
  rosette.add(new Mesh(new ExtrudeGeometry(petals, bevel), satin), ring, button)
  return rosette
}

/**
 * The spotlight without a light: a warm pool on the pedestal's top and a faint beam whose edges fade with the viewing
 * angle, so it reads as haze rather than a glass cone.
 */
export function createSpotlight(top: number, textures: StatueTextures) {
  const spotlight = new Group()
  const pool = new Mesh(
    new CircleGeometry(PEDESTAL.radius - 0.04, 48),
    new MeshBasicMaterial({ map: textures.pool, transparent: true, opacity: 0.9, depthWrite: false }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.y = top + 0.003
  pool.renderOrder = -1
  const beamHeight = 2.9
  const beamMaterial = new ShaderMaterial({
    uniforms: { colour: { value: new Color('#fff0c4') }, strength: { value: 0.5 } },
    vertexShader: `
      varying float facing;
      varying float along;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        facing = abs(dot(normalize(normalMatrix * normal), normalize(-viewPosition.xyz)));
        along = uv.y;
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: `
      uniform vec3 colour;
      uniform float strength;
      varying float facing;
      varying float along;
      void main() {
        float fade = (1.0 - along) * (1.0 - along);
        gl_FragColor = vec4(colour, strength * facing * facing * fade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const beam = new Mesh(new CylinderGeometry(0.2, PEDESTAL.radius - 0.02, beamHeight, 48, 1, true), beamMaterial)
  beam.position.y = top + beamHeight / 2
  beam.renderOrder = 2
  spotlight.add(pool, beam)
  return { spotlight, beamMaterial }
}

/** One twinkle: its size, height, phase, and speed ride along in `userData`. */
export function createSparkle(
  spot: [number, number, number, number],
  index: number,
  rank: StatueRank,
  top: number,
  textures: StatueTextures,
) {
  const [x, y, z, size] = spot
  const sprite = new Sprite(
    new SpriteMaterial({
      map: textures.sparkle,
      color: RANK_FINISHES[rank].sparkle,
      transparent: true,
      depthWrite: false,
    }),
  )
  sprite.position.set(x, top + y, z)
  sprite.userData = { size, baseY: top + y, phase: index * 2.1 + rank, speed: 1.3 + (index % 3) * 0.35 }
  sprite.renderOrder = 3
  return sprite
}

/** 0 most of the time and a quick soft swell now and then, so the twinkles never pulse in step. */
export function twinkle(seconds: number, phase: number, speed: number) {
  return Math.max(0, Math.sin(seconds * speed + phase)) ** 3
}

/** Still twinkles (motion 0) hold a steady middle size, so the place's glitter stays without moving. */
export function placeSparkle(sprite: Sprite, seconds: number, motion: number) {
  const { size, baseY, phase, speed } = sprite.userData as { size: number; baseY: number; phase: number; speed: number }
  const strength = 0.6 + (twinkle(seconds, phase, speed) - 0.6) * motion
  sprite.scale.setScalar(size * (0.5 + strength * 1.1))
  sprite.material.opacity = 0.35 + strength * 0.65
  sprite.material.rotation = seconds * 0.3 * speed * motion
  sprite.position.y = baseY + Math.sin(seconds * 0.5 * speed + baseY) * 0.025 * motion
}

/** Turns `arm` to hang along `direction` (figure space); an arm at rest hangs straight down. */
export function aimArm(arm: Group, direction: Vector3) {
  arm.quaternion.setFromUnitVectors(down, direction.clone().normalize())
}

/** Puts `prop` (its origin at the grip) in `arm`'s hand, standing along `direction` in figure space. */
export function holdInHand(arm: Group, prop: Object3D, direction: Vector3, gripOffset: number) {
  const along = direction.clone().normalize()
  const armTurn = arm.quaternion.clone().invert()
  prop.quaternion.copy(armTurn).multiply(new Quaternion().setFromUnitVectors(up, along))
  prop.position.set(0, -HAND_REACH, 0).addScaledVector(along.applyQuaternion(armTurn), -gripOffset)
  arm.add(prop)
}

/**
 * Proud poses: first raises the cup high and cheers with the other arm, second rests a bat on the shoulder and waves,
 * third cheers with both arms. Returns the waving arm's resting turn, or null.
 */
export function poseFigure(figure: StatueFigure, rank: StatueRank) {
  const [right, left] = figure.arms
  figure.legs[0].rotation.z = -0.07
  figure.legs[1].rotation.z = 0.07
  if (rank === 1) {
    aimArm(right, new Vector3(-0.29, 0.37, 0.18))
    left.rotation.set(0.2, 0, 2.3)
    figure.head.rotation.set(-0.08, -0.12, -0.05)
    return null
  }
  if (rank === 2) {
    aimArm(right, new Vector3(0.37, -0.26, 0.89))
    left.rotation.set(0.15, 0, 2.55)
    figure.head.rotation.set(-0.04, 0.1, -0.06)
    return left.rotation.z
  }
  right.rotation.set(0.2, 0, -2.35)
  left.rotation.set(0.2, 0, 2.35)
  figure.head.rotation.set(-0.08, 0, 0)
  return null
}

/** Puts first place's cup, leaning out from the head, or second place's bat, over the shoulder, in the right hand. */
export function holdProp(figure: StatueFigure, rank: StatueRank, prop: Object3D | null) {
  if (!prop) return
  const cup = rank === 1
  const along = cup ? new Vector3(-Math.sin(0.22), Math.cos(0.22), 0) : new Vector3(-0.48, 0.6, -0.64)
  holdInHand(figure.arms[0], prop, along, cup ? 0.08 : 0.12)
}

/** What a place holds: first the cup, second a bat, third nothing (both arms cheer). */
export function createProp(rank: StatueRank, metal: MeshStandardMaterial) {
  if (rank === 2) return createBat()
  if (rank === 3) return null
  // The cup's bowl mostly mirrors the studio floor, so it reflects more than the rim to stay golden when small.
  const cupMetal = metal.clone()
  cupMetal.envMapIntensity = 1.4
  const trophy = createTrophy(cupMetal)
  trophy.scale.setScalar(1.5)
  return trophy
}

/** The figure's colors as glossy vinyl, its ink eyes clearcoated. */
export function vinylPaint(textures: StatueTextures) {
  return (color: string): Material =>
    color === ink
      ? new MeshPhysicalMaterial({ color, envMap: textures.environment, ...EYE_FINISH })
      : new MeshStandardMaterial({ color, metalness: 0, envMap: textures.environment, ...FIGURE_FINISH })
}

/** An anonymous record's default batter: every color one palette blue, the eyes still ink. */
export function defaultBatterPaint(paint: FigurePaint): FigurePaint {
  return (color) => paint(color === ink ? ink : DEFAULT_BATTER_COLOR)
}

/** Who stands on a pedestal: a character, an anonymous record's default batter, or nobody yet (`null`). */
export type StatueLook = PlayerProfile | 'defaultBatter' | null

/** The shape a look stands in: the default character for the default batter and for an empty pedestal's plaster. */
export function lookProfile(look: StatueLook) {
  return look === null || look === 'defaultBatter' ? DEFAULT_PLAYER_PROFILE : look
}

export function statuePaint(look: StatueLook, textures: StatueTextures): FigurePaint {
  if (look === null) return plasterPaint()
  return look === 'defaultBatter' ? defaultBatterPaint(vinylPaint(textures)) : vinylPaint(textures)
}

/** Every color of an empty pedestal's figure is the same pale plaster. */
export function plasterPaint() {
  const plaster = new MeshStandardMaterial({ ...PLASTER, roughness: 1, transparent: true })
  return () => plaster
}

/** Gathers what a statue made for itself, leaving the town's shared character geometry alone. */
export function collectOwned(
  object: Object3D,
  shared: Set<BufferGeometry>,
  geometries: Set<BufferGeometry>,
  materials: Set<Material>,
) {
  if (object instanceof Mesh && !shared.has(object.geometry)) geometries.add(object.geometry)
  if (object instanceof Mesh || object instanceof Sprite) materials.add(object.material as Material)
}

/** A statue of `look` in `rank`'s place: a pedestal with a figure, or with plaster and no props while empty. */
export function createPaintedStatue(look: StatueLook, rank: StatueRank, textures: StatueTextures): PaintedStatue {
  const standing = look !== null
  const finish = RANK_FINISHES[rank]
  const group = new Group()
  const metal = new MeshStandardMaterial({
    color: finish.metal,
    metalness: 1,
    roughness: finish.roughness,
    envMap: textures.environment,
    envMapIntensity: 1.05,
  })
  const { pedestal, top } = createPedestal(finish, metal, textures, rank)
  const figure = createStatueFigure(lookProfile(look), statuePaint(look, textures))
  // Collected before any prop goes on, so the props are freed with the statue and the town's geometry never is.
  const shared = figureGeometries(figure)
  figure.root.scale.setScalar(FIGURE_HEIGHT / TOWN_CHARACTER_HEIGHT)
  figure.root.position.y = top
  const prop = standing ? createProp(rank, metal) : null
  const waveRest = poseFigure(figure, rank)
  holdProp(figure, rank, prop)
  const decorations = standing ? [createRosette(finish, metal)] : []
  decorations.forEach((rosette) => {
    rosette.position.set(0.16, 1.12, 0.2)
    figure.body.add(rosette)
  })
  const { spotlight, beamMaterial } = createSpotlight(top, textures)
  const spots = standing ? SPARKLE_SPOTS[rank] : []
  const sparkles = spots.map((spot, index) => createSparkle(spot, index, rank, top, textures))
  group.add(pedestal, figure.root, spotlight, ...sparkles)
  const sway = MathUtils.degToRad(finish.swayDegrees)

  const update = (seconds: number, motion: number) => {
    figure.root.rotation.y = motion * Math.sin((seconds * Math.PI * 2) / finish.swaySeconds + rank * 1.7) * sway
    if (waveRest !== null) figure.arms[1].rotation.z = waveRest + motion * Math.sin(seconds * 3.4) * 0.14
    beamMaterial.uniforms.strength.value = 0.5 + motion * Math.sin(seconds * 0.9) * 0.06
    sparkles.forEach((sprite) => placeSparkle(sprite, seconds, motion))
  }
  const dispose = () => {
    const geometries = new Set<BufferGeometry>()
    const materials = new Set<Material>(figure.materials)
    group.traverse((object) => collectOwned(object, shared, geometries, materials))
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
  }
  update(0, 0)
  return { group, update, dispose }
}
