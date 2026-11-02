import { CanvasTexture, Color, SRGBColorSpace, type WebGLProgramParametersWithUniforms } from 'three'
import { lerp, seededFraction, smoothstep } from '../../motionMath'

import type { Plaza } from './groundSurface'
import { closePaving, hexChannels, roundingWindow } from './pavingCorners'
import type { TownRoad } from '../objects/roads/roadLayout'

export type GroundLayout = { roads: TownRoad[]; plaza: Plaza | null }

/** The ground texture's span in metres and its size in pixels. */
const GROUND_SIZE = 106
const GROUND_PIXELS = 2048

export function drawGround({ roads, plaza }: GroundLayout) {
  const canvas = document.createElement('canvas')
  canvas.width = GROUND_PIXELS
  canvas.height = GROUND_PIXELS
  const context = canvas.getContext('2d')!
  context.translate(GROUND_PIXELS / 2, GROUND_PIXELS / 2)
  context.scale(GROUND_PIXELS / GROUND_SIZE, GROUND_PIXELS / GROUND_SIZE)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  roads.forEach(({ color, width, points }) => {
    context.beginPath()
    context.moveTo(points[0][0], points[0][1])
    points.slice(1, -1).forEach(([x, z], index) => {
      const [nextX, nextZ] = points[index + 2]
      context.quadraticCurveTo(x, z, (x + nextX) / 2, (z + nextZ) / 2)
    })
    const [endX, endZ] = points.at(-1)!
    context.lineTo(endX, endZ)
    context.strokeStyle = color
    context.lineWidth = width
    context.stroke()
  })
  if (plaza) {
    context.fillStyle = '#dfd0aa'
    context.beginPath()
    context.arc(plaza.x, plaza.z, plaza.radius, 0, Math.PI * 2)
    context.fill()
  }
  // Rounded pads where roads end, such as in front of a house door.
  roads.forEach(({ color, width, points }) => {
    const [x, z] = points.at(-1)!
    context.fillStyle = color
    context.beginPath()
    context.arc(x, z, width * 0.76, 0, Math.PI * 2)
    context.fill()
  })
  roads.forEach((road) => roundPavingCorners(context, road))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/**
 * Rounds the inner corners around a road that asks for it (a venue's branch path) to its `rounding` radius, in the
 * painted pixels themselves: the branch and the road it leaves stay one paving with no seam or color step.
 */
export function roundPavingCorners(context: CanvasRenderingContext2D, road: TownRoad) {
  if (!road.rounding) return
  const scale = GROUND_PIXELS / GROUND_SIZE
  const toPixel = (metres: number) => (metres + GROUND_SIZE / 2) * scale
  const bounds = roundingWindow(road, road.rounding)
  const left = Math.max(0, Math.floor(toPixel(bounds.minX)))
  const top = Math.max(0, Math.floor(toPixel(bounds.minZ)))
  const width = Math.min(GROUND_PIXELS, Math.ceil(toPixel(bounds.maxX))) - left
  const height = Math.min(GROUND_PIXELS, Math.ceil(toPixel(bounds.maxZ))) - top
  const image = context.getImageData(left, top, width, height)
  closePaving(image.data, width, height, road.rounding * scale, hexChannels(road.color))
  context.putImageData(image, left, top)
}

// How deep the snow lies at a ground point, from 0 to 1: deep drifts arrive first and melt last.
const SNOW_DEPTH_SIZE = 512

/** Smooth noise from 0 to 1 that changes over about one unit. */
export function valueNoise(x: number, z: number) {
  const left = Math.floor(x)
  const top = Math.floor(z)
  const across = smoothstep(x - left)
  const down = smoothstep(z - top)
  const upper = lerp(seededFraction(left, top), seededFraction(left + 1, top), across)
  const lower = lerp(seededFraction(left, top + 1), seededFraction(left + 1, top + 1), across)
  return lerp(upper, lower, down)
}

/** Thins the snow along every road and around the plaza, `margin` wider than each. */
export function thinSnowBeside(context: CanvasRenderingContext2D, { roads, plaza }: GroundLayout, margin: number) {
  roads.forEach(({ width, points }) => {
    context.beginPath()
    points.forEach(([x, z]) => context.lineTo(x, z))
    context.lineWidth = width + margin
    context.stroke()
  })
  if (!plaza) return
  context.beginPath()
  context.arc(plaza.x, plaza.z, plaza.radius + margin / 2, 0, Math.PI * 2)
  context.fill()
}

/**
 * Patchy drifts from layered noise, shallower beside roads and the plaza, where people walk and the snow melts
 * first. The ground shader reveals the deepest snow first as it falls and keeps it longest as it melts.
 */
export function drawSnowDepth(layout: GroundLayout) {
  const canvas = document.createElement('canvas')
  canvas.width = SNOW_DEPTH_SIZE
  canvas.height = SNOW_DEPTH_SIZE
  const context = canvas.getContext('2d')!
  const pixels = context.createImageData(SNOW_DEPTH_SIZE, SNOW_DEPTH_SIZE)
  for (let pixel = 0; pixel < SNOW_DEPTH_SIZE * SNOW_DEPTH_SIZE; pixel += 1) {
    const x = ((pixel % SNOW_DEPTH_SIZE) / SNOW_DEPTH_SIZE) * 106 - 53
    const z = (Math.floor(pixel / SNOW_DEPTH_SIZE) / SNOW_DEPTH_SIZE) * 106 - 53
    const depth =
      0.55 * valueNoise(x / 9, z / 9) +
      0.3 * valueNoise(x / 3.4 + 17, z / 3.4) +
      0.15 * valueNoise(x / 1.3, z / 1.3 + 9)
    pixels.data.fill(Math.round(40 + depth * 215), pixel * 4, pixel * 4 + 3)
    pixels.data[pixel * 4 + 3] = 255
  }
  context.putImageData(pixels, 0, 0)
  context.translate(SNOW_DEPTH_SIZE / 2, SNOW_DEPTH_SIZE / 2)
  context.scale(SNOW_DEPTH_SIZE / 106, SNOW_DEPTH_SIZE / 106)
  context.lineCap = 'round'
  context.strokeStyle = 'rgba(0, 0, 0, 0.1)'
  context.fillStyle = 'rgba(0, 0, 0, 0.1)'
  ;[9, 7.5, 6, 4.5, 3, 1.5].forEach((margin) => thinSnowBeside(context, layout, margin))
  return new CanvasTexture(canvas)
}

const snowSlushColor = new Color('#b4c6ca')

/** Snow shows where its depth passes the current cover, with a wet, grey-blue rim where it is melting. */
export function addSnowCover(shader: WebGLProgramParametersWithUniforms, snowCover: { value: number }) {
  shader.uniforms.snowCover = snowCover
  shader.uniforms.snowSlushColor = { value: snowSlushColor }
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float snowCover;\nuniform vec3 snowSlushColor;\nvoid main() {')
    .replace(
      '#include <alphamap_fragment>',
      `float snowDepth = texture2D( alphaMap, vAlphaMapUv ).g;
      float snowLine = 1.0 - snowCover * 1.12;
      diffuseColor.a *= smoothstep( snowLine, snowLine + 0.035, snowDepth );
      diffuseColor.rgb = mix( snowSlushColor, diffuseColor.rgb, smoothstep( snowLine, snowLine + 0.14, snowDepth ) );`,
    )
}
