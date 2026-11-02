import { CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace, type Texture } from 'three'
import { PEDESTAL_COLORS, RANK_FINISHES, STATUE_RANKS, type StatueRank } from './statueFinishes'

// What every painted statue in one canvas shares, painted on 2D canvases: no file to fetch, so the statues draw under
// the strict `connect-src 'self'` of /baseball. Metal with no environment to reflect renders black, so the studio is
// each statue's own `envMap` (three bakes it on first use); it never goes on `scene.environment`, which would make the
// whole matte town shine.

export type StatueTextures = {
  environment: Texture
  sparkle: Texture
  pool: Texture
  frameMask: Texture
  plaques: Record<StatueRank, Texture>
}

export type Painter = (context: CanvasRenderingContext2D, width: number, height: number) => void

export function canvasTexture(width: number, height: number, paint: Painter) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) paint(context, width, height)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export function createStatueTextures(): StatueTextures {
  const environment = canvasTexture(512, 256, paintStudio)
  environment.mapping = EquirectangularReflectionMapping
  const plaque = (rank: StatueRank) =>
    canvasTexture(512, 116, paintPlaque(PEDESTAL_COLORS.plaque, RANK_FINISHES[rank].emblem))
  return {
    environment,
    sparkle: canvasTexture(64, 64, paintSparkle),
    pool: canvasTexture(128, 128, paintPool),
    frameMask: canvasTexture(256, 68, paintRoundedMask),
    plaques: { 1: plaque(1), 2: plaque(2), 3: plaque(3) },
  }
}

export function disposeStatueTextures(textures: StatueTextures) {
  const { plaques, ...shared } = textures
  ;[...Object.values(shared), ...STATUE_RANKS.map((rank) => plaques[rank])].forEach((texture) => texture.dispose())
}

/** A bright cream ceiling with soft boxes over a warm horizon and a darker floor, which gives the metal its contrast. */
export function paintStudio(context: CanvasRenderingContext2D, width: number, height: number) {
  const sky = context.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, '#fffaf0')
  sky.addColorStop(0.4, '#f1e6cf')
  sky.addColorStop(0.5, '#cbb894')
  sky.addColorStop(0.62, '#9c8870')
  sky.addColorStop(1, '#66574a')
  context.fillStyle = sky
  context.fillRect(0, 0, width, height)
  const softBoxes = [
    [0.12, 0.22, 0.09, 0.07],
    [0.38, 0.14, 0.12, 0.06],
    [0.63, 0.25, 0.07, 0.1],
    [0.88, 0.18, 0.1, 0.06],
    [0.5, 0.36, 0.05, 0.04],
  ]
  softBoxes.forEach(([x, y, radiusX, radiusY]) =>
    paintGlow(context, x * width, y * height, radiusX * width, radiusY * height),
  )
}

export function paintGlow(context: CanvasRenderingContext2D, x: number, y: number, radiusX: number, radiusY: number) {
  context.save()
  context.translate(x, y)
  context.scale(radiusX, radiusY)
  const glow = context.createRadialGradient(0, 0, 0, 0, 0, 1)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.55, 'rgba(255,253,246,0.85)')
  glow.addColorStop(1, 'rgba(255,250,240,0)')
  context.fillStyle = glow
  context.fillRect(-1, -1, 2, 2)
  context.restore()
}

/** A soft four-point twinkle with a round glow, white so each sprite tints it to its place's color. */
export function paintSparkle(context: CanvasRenderingContext2D, width: number, height: number) {
  const middle = width / 2
  const glow = context.createRadialGradient(middle, middle, 0, middle, middle, middle)
  glow.addColorStop(0, 'rgba(255,255,255,0.9)')
  glow.addColorStop(0.25, 'rgba(255,255,255,0.35)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.moveTo(middle, 2)
  context.quadraticCurveTo(middle + 4, middle - 4, width - 2, middle)
  context.quadraticCurveTo(middle + 4, middle + 4, middle, height - 2)
  context.quadraticCurveTo(middle - 4, middle + 4, 2, middle)
  context.quadraticCurveTo(middle - 4, middle - 4, middle, 2)
  context.fill()
}

/** The warm light pool on a pedestal's top, where a spotlight would land. */
export function paintPool(context: CanvasRenderingContext2D, width: number) {
  const middle = width / 2
  const pool = context.createRadialGradient(middle, middle, 0, middle, middle, middle)
  pool.addColorStop(0, 'rgba(255,250,232,0.95)')
  pool.addColorStop(0.55, 'rgba(255,246,220,0.55)')
  pool.addColorStop(1, 'rgba(255,244,214,0)')
  context.fillStyle = pool
  context.fillRect(0, 0, width, width)
}

/** The plaque: enamel in `color` with a soft top highlight, a thin inlay line, and a star in the place's metal. */
export function paintPlaque(color: string, metal: string): Painter {
  return (context, width, height) => {
    const inset = 6
    context.beginPath()
    context.roundRect(inset, inset, width - inset * 2, height - inset * 2, 34)
    context.fillStyle = color
    context.fill()
    const shine = context.createLinearGradient(0, inset, 0, height - inset)
    shine.addColorStop(0, 'rgba(255,255,255,0.3)')
    shine.addColorStop(0.35, 'rgba(255,255,255,0)')
    shine.addColorStop(0.85, 'rgba(0,0,0,0)')
    shine.addColorStop(1, 'rgba(0,0,0,0.08)')
    context.fillStyle = shine
    context.fill()
    context.beginPath()
    context.roundRect(20, 20, width - 40, height - 40, 22)
    context.strokeStyle = metal
    context.globalAlpha = 0.55
    context.lineWidth = 3
    context.stroke()
    context.globalAlpha = 1
    paintStar(context, width / 2, height / 2 + 2, height * 0.36, metal)
  }
}

/** A five-point star with a soft lower shade, like enamel. */
export function paintStar(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  context.beginPath()
  Array.from({ length: 10 }, (_, index) => {
    const reach = index % 2 === 0 ? radius : radius * 0.46
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    return [x + Math.cos(angle) * reach, y + Math.sin(angle) * reach]
  }).forEach(([pointX, pointY]) => context.lineTo(pointX, pointY))
  context.closePath()
  context.fillStyle = color
  context.fill()
  const shade = context.createLinearGradient(0, y - radius, 0, y + radius)
  shade.addColorStop(0, 'rgba(255,255,255,0.35)')
  shade.addColorStop(0.5, 'rgba(255,255,255,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.18)')
  context.fillStyle = shade
  context.fill()
}

/** A white rounded rectangle on black: the alpha mask of the metal frame behind the plaque. */
export function paintRoundedMask(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = '#000000'
  context.fillRect(0, 0, width, height)
  context.beginPath()
  context.roundRect(2, 2, width - 4, height - 4, 40)
  context.fillStyle = '#ffffff'
  context.fill()
}
