import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import { seededFraction } from '../../motionMath'

// The field's textures are drawn in light greys, so the season's color on the material tints them like the town's
// grass and hedges (scene/environment/season.ts). Seeded, so the park looks the same on every visit.

/** A texture `draw` paints on a canvas; a `tiled` one, as the field's are, repeats and stays sharp at grazing angles. */
export function createCanvasTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number, height: number) => void,
  height = size,
  { tiled = true } = {},
) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) draw(context, size, height)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  if (!tiled) return texture
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  return texture
}

/** Draws on `texture`'s canvas again and has the texture uploaded again. */
export function redrawCanvasTexture(
  texture: CanvasTexture,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
) {
  const canvas = texture.image as HTMLCanvasElement
  const context = canvas.getContext('2d')
  if (!context) return
  draw(context, canvas.width)
  texture.needsUpdate = true
}

/** Two mowing stripes, light and dark, flecked with light and shadow. */
export function drawLawn(context: CanvasRenderingContext2D, size: number) {
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size, size)
  context.fillStyle = '#e4e8de'
  context.fillRect(0, 0, size / 2, size)
  Array.from({ length: 900 }, (_, index) => index).forEach((index) => {
    context.fillStyle = seededFraction(index, 1) > 0.5 ? 'rgba(255, 255, 250, 0.35)' : 'rgba(40, 60, 40, 0.07)'
    context.fillRect(seededFraction(index, 2) * size, seededFraction(index, 3) * size, 2, 3)
  })
}

/** A trimmed hedge's leaves: overlapping ellipses in a few greys. */
export function drawLeaves(context: CanvasRenderingContext2D, size: number) {
  context.fillStyle = '#e2e5de'
  context.fillRect(0, 0, size, size)
  const shades = ['#c4c8c0', '#d4d7cf', '#e2e5de', '#eff1ec', '#ffffff']
  Array.from({ length: 1500 }, (_, index) => index).forEach((index) => {
    const length = seededFraction(index, 7)
    context.fillStyle = shades[Math.floor(seededFraction(index, 4) * shades.length)]
    context.beginPath()
    context.ellipse(
      seededFraction(index, 5) * size,
      seededFraction(index, 6) * size,
      5 + length * 4,
      2.6 + length * 2,
      seededFraction(index, 8) * Math.PI,
      0,
      Math.PI * 2,
    )
    context.fill()
  })
}

/** Greenhouse glass: a faint tint and a glint, framed into panes, six across and three up. */
export function drawGlass(context: CanvasRenderingContext2D, size: number) {
  context.fillStyle = 'rgba(196, 232, 222, 0.3)'
  context.fillRect(0, 0, size, size)
  context.fillStyle = 'rgba(255, 255, 255, 0.28)'
  context.beginPath()
  context.moveTo(size * 0.16, 0)
  context.lineTo(size * 0.35, 0)
  context.lineTo(size * 0.12, size)
  context.lineTo(0, size)
  context.fill()
  context.strokeStyle = '#fbf8f0'
  context.lineWidth = 7
  const columns = Array.from({ length: 7 }, (_, column) => (column / 6) * size)
  const rows = Array.from({ length: 4 }, (_, row) => (row / 3) * size)
  context.beginPath()
  columns.forEach((x) => {
    context.moveTo(x, 0)
    context.lineTo(x, size)
  })
  rows.forEach((y) => {
    context.moveTo(0, y)
    context.lineTo(size, y)
  })
  context.stroke()
}
