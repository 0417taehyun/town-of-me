import { CanvasTexture } from 'three'

let glowTexture: CanvasTexture | null = null

/**
 * A soft round falloff for every light that is painted on instead of lit (lamp halos, light pools, window light,
 * stars, fireflies). One small texture is shared for the life of the page.
 */
export function getGlowTexture() {
  if (glowTexture) return glowTexture
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(0.65, 'rgba(255,255,255,0.15)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  glowTexture = new CanvasTexture(canvas)
  return glowTexture
}
